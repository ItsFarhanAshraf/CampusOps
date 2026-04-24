from decimal import Decimal

from rest_framework import serializers

from finance.models import FeeStructure, Invoice, InvoiceLine, Payment
from finance.services import invoice_amount_paid, invoice_line_total


class FeeStructureSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeStructure
        fields = (
            "id",
            "code",
            "name",
            "amount",
            "term",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def validate_code(self, value: str) -> str:
        v = value.strip().upper()
        if len(v) < 2:
            raise serializers.ValidationError("Code is too short.")
        return v

    def validate_name(self, value: str) -> str:
        v = value.strip()
        if not v:
            raise serializers.ValidationError("Name is required.")
        return v


class InvoiceLineNestedSerializer(serializers.ModelSerializer):
    """Line payload for nested invoice create (no invoice FK in body)."""

    class Meta:
        model = InvoiceLine
        fields = (
            "fee_structure",
            "label",
            "quantity",
            "unit_price",
            "amount",
        )

    def validate(self, attrs):
        fs = attrs.get("fee_structure")
        if fs:
            attrs["label"] = (attrs.get("label") or fs.name).strip()
            unit = attrs.get("unit_price", fs.amount)
            qty = attrs.get("quantity", Decimal("1"))
            attrs["unit_price"] = unit
            attrs["quantity"] = qty
            attrs["amount"] = (qty * unit).quantize(Decimal("0.01"))
        qty = attrs.get("quantity")
        unit = attrs.get("unit_price")
        amount = attrs.get("amount")
        if qty is None or unit is None or amount is None:
            return attrs
        expected = (qty * unit).quantize(Decimal("0.01"))
        if amount.quantize(Decimal("0.01")) != expected:
            raise serializers.ValidationError(
                {"amount": "Amount must equal quantity × unit_price (rounded to 2 decimals)."},
            )
        return attrs


class InvoiceLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceLine
        fields = (
            "id",
            "invoice",
            "fee_structure",
            "label",
            "quantity",
            "unit_price",
            "amount",
        )
        read_only_fields = ("id",)

    def validate(self, attrs):
        inst = self.instance
        fs = attrs.get("fee_structure")
        if fs is None and inst is not None:
            fs = inst.fee_structure
        if fs:
            label = (attrs.get("label") or getattr(inst, "label", None) or fs.name).strip()
            attrs["label"] = label
            unit = attrs.get("unit_price", getattr(inst, "unit_price", None) or fs.amount)
            qty = attrs.get("quantity", getattr(inst, "quantity", None) or Decimal("1"))
            attrs["unit_price"] = unit
            attrs["quantity"] = qty
            attrs["amount"] = (qty * unit).quantize(Decimal("0.01"))
        qty = attrs.get("quantity", getattr(inst, "quantity", None))
        unit = attrs.get("unit_price", getattr(inst, "unit_price", None))
        amount = attrs.get("amount", getattr(inst, "amount", None))
        if qty is None or unit is None or amount is None:
            return attrs
        expected = (qty * unit).quantize(Decimal("0.01"))
        if amount.quantize(Decimal("0.01")) != expected:
            raise serializers.ValidationError(
                {"amount": "Amount must equal quantity × unit_price (rounded to 2 decimals)."},
            )
        return attrs


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = (
            "id",
            "invoice",
            "amount",
            "method",
            "reference",
            "status",
            "recorded_by",
            "created_at",
        )
        read_only_fields = ("invoice", "status", "recorded_by", "created_at")


class InvoiceSerializer(serializers.ModelSerializer):
    lines = InvoiceLineSerializer(many=True, read_only=True)
    line_total = serializers.SerializerMethodField()
    amount_paid = serializers.SerializerMethodField()
    balance = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = (
            "id",
            "student",
            "status",
            "due_date",
            "currency",
            "notes",
            "issued_at",
            "created_at",
            "updated_at",
            "lines",
            "line_total",
            "amount_paid",
            "balance",
        )
        read_only_fields = (
            "student",
            "status",
            "issued_at",
            "created_at",
            "updated_at",
            "lines",
            "line_total",
            "amount_paid",
            "balance",
        )

    def get_line_total(self, obj: Invoice) -> str:
        return str(invoice_line_total(obj))

    def get_amount_paid(self, obj: Invoice) -> str:
        return str(invoice_amount_paid(obj))

    def get_balance(self, obj: Invoice) -> str:
        bal = invoice_line_total(obj) - invoice_amount_paid(obj)
        return str(bal)


class InvoiceCreateSerializer(serializers.ModelSerializer):
    lines = InvoiceLineNestedSerializer(many=True)

    class Meta:
        model = Invoice
        fields = (
            "id",
            "student",
            "due_date",
            "currency",
            "notes",
            "lines",
        )
        read_only_fields = ("id",)

    def validate_lines(self, value: list) -> list:
        if not value:
            raise serializers.ValidationError("At least one invoice line is required.")
        return value

    def create(self, validated_data):
        lines_data = validated_data.pop("lines")
        invoice = Invoice.objects.create(**validated_data)
        for line in lines_data:
            InvoiceLine.objects.create(invoice=invoice, **line)
        return invoice


class InvoiceUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = ("due_date", "currency", "notes")

    def validate(self, attrs):
        if self.instance and self.instance.status != Invoice.Status.DRAFT:
            raise serializers.ValidationError(
                {"detail": "Only draft invoices can be edited."},
            )
        return attrs


class RecordPaymentSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    method = serializers.ChoiceField(choices=Payment.Method.choices)
    reference = serializers.CharField(required=False, allow_blank=True, max_length=128)

    def validate_amount(self, value: Decimal) -> Decimal:
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return value
