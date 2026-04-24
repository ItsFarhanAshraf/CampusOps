from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from finance.models import Invoice, Payment


def invoice_line_total(invoice: Invoice) -> Decimal:
    total = invoice.lines.aggregate(s=Sum("amount"))["s"]
    return total if total is not None else Decimal("0")


def invoice_amount_paid(invoice: Invoice) -> Decimal:
    total = invoice.payments.filter(status=Payment.Status.COMPLETED).aggregate(s=Sum("amount"))["s"]
    return total if total is not None else Decimal("0")


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
    paid = invoice_amount_paid(inv)
    remaining = total - paid
    if amount <= 0 or amount > remaining:
        raise ValidationError(
            {
                "amount": (
                    f"Amount must be greater than zero and at most the remaining "
                    f"balance ({remaining})."
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
    paid_after = paid + amount
    if paid_after >= total:
        inv.status = Invoice.Status.PAID
    else:
        inv.status = Invoice.Status.PARTIALLY_PAID
    inv.save(update_fields=["status", "updated_at"])
    return inv, payment


@transaction.atomic
def void_invoice(*, invoice: Invoice) -> Invoice:
    inv = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if inv.status == Invoice.Status.VOID:
        return inv
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
