from datetime import timedelta
from decimal import ROUND_DOWN, Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from finance.dates import next_due_date
from finance.models import Installment, InstallmentPlan, Invoice, Payment


def invoice_line_total(invoice: Invoice) -> Decimal:
    total = invoice.lines.aggregate(s=Sum("amount"))["s"]
    return total if total is not None else Decimal("0")


def invoice_amount_paid(invoice: Invoice) -> Decimal:
    total = invoice.payments.filter(status=Payment.Status.COMPLETED).aggregate(s=Sum("amount"))["s"]
    return total if total is not None else Decimal("0")


def invoice_amount_pending(invoice: Invoice) -> Decimal:
    total = invoice.payments.filter(status=Payment.Status.PENDING).aggregate(s=Sum("amount"))["s"]
    return total if total is not None else Decimal("0")


def allocatable_remaining(invoice: Invoice) -> Decimal:
    """Amount still available for new completed or pending payments."""
    return invoice_line_total(invoice) - invoice_amount_paid(invoice) - invoice_amount_pending(invoice)


def split_principal(amount: Decimal, n: int) -> list[Decimal]:
    if n < 2:
        raise ValidationError(
            {"num_installments": "At least two installments are required."},
        )
    if amount <= 0:
        raise ValidationError({"detail": "Principal must be greater than zero."})
    base = (amount / Decimal(n)).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    parts = [base] * n
    remainder = (amount - sum(parts)).quantize(Decimal("0.01"))
    parts[-1] = (parts[-1] + remainder).quantize(Decimal("0.01"))
    return parts


@transaction.atomic
def issue_invoice(*, invoice: Invoice) -> Invoice:
    inv = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if inv.status != Invoice.Status.DRAFT:
        raise ValidationError({"detail": "Only draft invoices can be issued."})
    total = invoice_line_total(inv)
    if total <= 0:
        raise ValidationError(
            {"detail": "Invoice must have at least one line with a positive total."},
        )
    inv.status = Invoice.Status.ISSUED
    inv.issued_at = timezone.now()
    inv.save(update_fields=["status", "issued_at", "updated_at"])
    return inv


@transaction.atomic
def record_payment(
    *,
    invoice: Invoice,
    amount: Decimal,
    method: str,
    reference: str,
    user,
) -> tuple[Invoice, Payment]:
    inv = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if inv.status == Invoice.Status.VOID:
        raise ValidationError({"detail": "Void invoices cannot accept payments."})
    if inv.status == Invoice.Status.DRAFT:
        raise ValidationError({"detail": "Issue the invoice before recording payments."})
    if inv.status == Invoice.Status.PAID:
        raise ValidationError({"detail": "Invoice is already fully paid."})
    total = invoice_line_total(inv)
    remaining = allocatable_remaining(inv)
    if amount <= 0 or amount > remaining:
        raise ValidationError(
            {
                "amount": (
                    f"Amount must be greater than zero and at most the remaining "
                    f"allocatable balance ({remaining}). Pending authorizations reduce availability."
                ),
            },
        )
    payment = Payment.objects.create(
        invoice=inv,
        amount=amount,
        method=method,
        reference=reference or "",
        status=Payment.Status.COMPLETED,
        recorded_by=user if user and user.is_authenticated else None,
    )
    _refresh_invoice_payment_status(inv)
    return inv, payment


def _refresh_invoice_payment_status(inv: Invoice) -> None:
    total = invoice_line_total(inv)
    paid = invoice_amount_paid(inv)
    if paid >= total:
        inv.status = Invoice.Status.PAID
    elif paid > 0:
        inv.status = Invoice.Status.PARTIALLY_PAID
    else:
        if inv.status not in (Invoice.Status.DRAFT, Invoice.Status.VOID):
            inv.status = Invoice.Status.ISSUED
    inv.save(update_fields=["status", "updated_at"])


@transaction.atomic
def initiate_pending_payment(
    *,
    invoice: Invoice,
    amount: Decimal,
    method: str,
    reference: str,
    client_reference: str,
    user,
    expires_at,
) -> tuple[Invoice, Payment]:
    inv = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if inv.status == Invoice.Status.VOID:
        raise ValidationError({"detail": "Void invoices cannot accept payments."})
    if inv.status == Invoice.Status.DRAFT:
        raise ValidationError({"detail": "Issue the invoice before starting a payment."})
    if inv.status == Invoice.Status.PAID:
        raise ValidationError({"detail": "Invoice is already fully paid."})
    remaining = allocatable_remaining(inv)
    if amount <= 0 or amount > remaining:
        raise ValidationError(
            {
                "amount": (
                    f"Amount must be greater than zero and at most the remaining "
                    f"allocatable balance ({remaining})."
                ),
            },
        )
    payment = Payment.objects.create(
        invoice=inv,
        amount=amount,
        method=method,
        reference=reference or "",
        status=Payment.Status.PENDING,
        recorded_by=user if user and user.is_authenticated else None,
        expires_at=expires_at,
        client_reference=client_reference or "",
    )
    return inv, payment


@transaction.atomic
def confirm_pending_payment(*, payment: Payment) -> tuple[Invoice, Payment]:
    pay = Payment.objects.select_for_update().get(pk=payment.pk)
    if pay.status != Payment.Status.PENDING:
        raise ValidationError({"detail": "Only pending payments can be confirmed."})
    if pay.expires_at and pay.expires_at < timezone.now():
        pay.status = Payment.Status.FAILED
        pay.save(update_fields=["status", "updated_at"])
        raise ValidationError({"detail": "This pending payment has expired."})
    inv = Invoice.objects.select_for_update().get(pk=pay.invoice_id)
    if inv.status in (Invoice.Status.VOID, Invoice.Status.DRAFT):
        raise ValidationError({"detail": "Invoice is not payable in its current state."})
    pay.status = Payment.Status.COMPLETED
    pay.save(update_fields=["status", "updated_at"])
    _refresh_invoice_payment_status(inv)
    inv.refresh_from_db(fields=["status", "updated_at"])
    return inv, pay


@transaction.atomic
def cancel_pending_payment(*, payment: Payment) -> Payment:
    pay = Payment.objects.select_for_update().get(pk=payment.pk)
    if pay.status != Payment.Status.PENDING:
        raise ValidationError({"detail": "Only pending payments can be cancelled."})
    pay.status = Payment.Status.CANCELLED
    pay.save(update_fields=["status", "updated_at"])
    return pay


@transaction.atomic
def void_invoice(*, invoice: Invoice) -> Invoice:
    inv = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if inv.status == Invoice.Status.VOID:
        return inv
    if invoice_amount_pending(inv) > 0:
        raise ValidationError(
            {
                "detail": (
                    "Cancel or confirm pending payment authorizations before voiding "
                    "this invoice."
                ),
            },
        )
    if invoice_amount_paid(inv) > 0:
        raise ValidationError(
            {
                "detail": (
                    "Invoices with completed payments cannot be voided "
                    "(refunds are not implemented in this phase)."
                ),
            },
        )
    inv.status = Invoice.Status.VOID
    inv.save(update_fields=["status", "updated_at"])
    return inv


@transaction.atomic
def create_installment_plan(
    *,
    invoice: Invoice,
    num_installments: int,
    first_due_date,
    frequency: str,
    title: str,
) -> InstallmentPlan:
    inv = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if inv.status in (Invoice.Status.DRAFT, Invoice.Status.VOID):
        raise ValidationError({"detail": "Installment plans can only attach to issued invoices."})
    if hasattr(inv, "installment_plan"):
        raise ValidationError({"detail": "This invoice already has an installment plan."})
    principal = allocatable_remaining(inv)
    if principal <= 0:
        raise ValidationError(
            {"detail": "No remaining balance is available to schedule (check pending holds)."},
        )
    parts = split_principal(principal, num_installments)
    plan = InstallmentPlan.objects.create(
        invoice=inv,
        title=(title or "").strip(),
        frequency=frequency,
        num_installments=num_installments,
        principal_amount=principal,
    )
    for idx, amount in enumerate(parts):
        due = next_due_date(first_due_date, frequency, idx)
        Installment.objects.create(
            plan=plan,
            sequence=idx + 1,
            due_date=due,
            amount=amount,
            status=Installment.Status.SCHEDULED,
        )
    return plan
