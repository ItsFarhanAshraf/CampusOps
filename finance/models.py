from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

User = settings.AUTH_USER_MODEL


class FeeStructure(models.Model):
    """Catalog fee used to populate invoice lines with consistent pricing."""

    code = models.CharField(max_length=32)
    name = models.CharField(max_length=255)
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    term = models.CharField(max_length=64, blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code", "term"]
        constraints = [
            models.UniqueConstraint(
                fields=["code", "term"],
                name="finance_feestructure_unique_code_term",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.code} ({self.term or 'default'})"


class Invoice(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ISSUED = "issued", "Issued"
        PARTIALLY_PAID = "partially_paid", "Partially paid"
        PAID = "paid", "Paid"
        VOID = "void", "Void"

    student = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="invoices",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    due_date = models.DateField()
    currency = models.CharField(max_length=3, default="USD")
    notes = models.TextField(blank=True, default="")
    issued_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Invoice #{self.pk} — {self.student.email} ({self.status})"


class InvoiceLine(models.Model):
    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        related_name="lines",
    )
    fee_structure = models.ForeignKey(
        FeeStructure,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="invoice_lines",
    )
    label = models.CharField(max_length=255)
    quantity = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("1"),
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    unit_price = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
    )
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"{self.label} ({self.amount})"


class Payment(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    class Method(models.TextChoices):
        CARD = "card", "Card"
        CASH = "cash", "Cash"
        BANK_TRANSFER = "bank_transfer", "Bank transfer"
        OTHER = "other", "Other"

    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.PROTECT,
        related_name="payments",
    )
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    method = models.CharField(max_length=32, choices=Method.choices)
    reference = models.CharField(max_length=128, blank=True, default="")
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.COMPLETED,
    )
    recorded_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recorded_payments",
    )
    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Pending authorizations may expire (client-side enforcement + API checks).",
    )
    client_reference = models.CharField(
        max_length=128,
        blank=True,
        default="",
        help_text="Optional PSP / correlation id (e.g. Stripe PaymentIntent id).",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Payment {self.amount} on invoice {self.invoice_id}"


class InstallmentPlan(models.Model):
    class Frequency(models.TextChoices):
        WEEKLY = "weekly", "Weekly"
        MONTHLY = "monthly", "Monthly"

    invoice = models.OneToOneField(
        Invoice,
        on_delete=models.CASCADE,
        related_name="installment_plan",
    )
    title = models.CharField(max_length=255, blank=True, default="")
    frequency = models.CharField(
        max_length=16,
        choices=Frequency.choices,
        default=Frequency.MONTHLY,
    )
    num_installments = models.PositiveIntegerField()
    principal_amount = models.DecimalField(max_digits=12, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Plan for invoice {self.invoice_id}"


class Installment(models.Model):
    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        PAID = "paid", "Paid"
        CANCELLED = "cancelled", "Cancelled"

    plan = models.ForeignKey(
        InstallmentPlan,
        on_delete=models.CASCADE,
        related_name="installments",
    )
    sequence = models.PositiveIntegerField()
    due_date = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.SCHEDULED,
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    payment = models.ForeignKey(
        Payment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="installments",
    )

    class Meta:
        ordering = ["plan", "sequence"]
        constraints = [
            models.UniqueConstraint(
                fields=["plan", "sequence"],
                name="finance_installment_unique_sequence",
            ),
        ]

    def display_status(self) -> str:
        from django.utils import timezone

        if self.status == self.Status.SCHEDULED and self.due_date < timezone.now().date():
            return "overdue"
        return self.status

    def __str__(self) -> str:
        return f"Installment {self.sequence} ({self.amount}) due {self.due_date}"
