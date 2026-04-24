from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from finance.models import FeeStructure, Invoice, InvoiceLine, Payment
from finance.permissions import ReadAuthenticatedOrFinanceManageWrite, user_can_manage_finance
from finance.serializers import (
    FeeStructureSerializer,
    InvoiceCreateSerializer,
    InvoiceSerializer,
    InvoiceUpdateSerializer,
    InvoiceLineSerializer,
    PaymentSerializer,
    RecordPaymentSerializer,
)
from finance.services import issue_invoice, record_payment, void_invoice


def _invoices_for(user):
    qs = Invoice.objects.select_related("student").prefetch_related("lines", "payments")
    if user.is_superuser or user.is_staff or user_can_manage_finance(user):
        return qs
    return qs.filter(student=user)


def _lines_for(user):
    qs = InvoiceLine.objects.select_related("invoice", "fee_structure")
    if user.is_superuser or user.is_staff or user_can_manage_finance(user):
        return qs
    return qs.filter(invoice__student=user)


def _payments_for(user):
    qs = Payment.objects.select_related("invoice", "recorded_by")
    if user.is_superuser or user.is_staff or user_can_manage_finance(user):
        return qs
    return qs.filter(invoice__student=user)


class FeeStructureViewSet(viewsets.ModelViewSet):
    permission_classes = [ReadAuthenticatedOrFinanceManageWrite]
    serializer_class = FeeStructureSerializer

    def get_queryset(self):
        qs = FeeStructure.objects.all().order_by("code", "term")
        user = self.request.user
        if user_can_manage_finance(user):
            return qs
        return qs.filter(is_active=True)


class InvoiceViewSet(viewsets.ModelViewSet):
    permission_classes = [ReadAuthenticatedOrFinanceManageWrite]

    def get_queryset(self):
        return _invoices_for(self.request.user)

    def get_serializer_class(self):
        if self.action == "create":
            return InvoiceCreateSerializer
        if self.action in ("update", "partial_update"):
            return InvoiceUpdateSerializer
        return InvoiceSerializer

    def perform_destroy(self, instance):
        if instance.status != Invoice.Status.DRAFT:
            raise ValidationError({"detail": "Only draft invoices can be deleted."})
        super().perform_destroy(instance)

    @action(detail=True, methods=["post"], url_path="issue")
    def issue(self, request, pk=None):
        if not user_can_manage_finance(request.user):
            raise PermissionDenied()
        invoice = self.get_object()
        try:
            issue_invoice(invoice=invoice)
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        refreshed = self.get_queryset().get(pk=invoice.pk)
        return Response(
            InvoiceSerializer(refreshed, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="record-payment")
    def record_payment(self, request, pk=None):
        if not user_can_manage_finance(request.user):
            raise PermissionDenied()
        invoice = self.get_object()
        ser = RecordPaymentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            inv, payment = record_payment(
                invoice=invoice,
                amount=ser.validated_data["amount"],
                method=ser.validated_data["method"],
                reference=ser.validated_data.get("reference", ""),
                user=request.user,
            )
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "invoice": InvoiceSerializer(inv, context={"request": request}).data,
                "payment": PaymentSerializer(payment, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="void")
    def void(self, request, pk=None):
        if not user_can_manage_finance(request.user):
            raise PermissionDenied()
        invoice = self.get_object()
        try:
            void_invoice(invoice=invoice)
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        refreshed = self.get_queryset().get(pk=invoice.pk)
        return Response(
            InvoiceSerializer(refreshed, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


class InvoiceLineViewSet(viewsets.ModelViewSet):
    permission_classes = [ReadAuthenticatedOrFinanceManageWrite]
    serializer_class = InvoiceLineSerializer

    def get_queryset(self):
        qs = _lines_for(self.request.user)
        inv = self.request.query_params.get("invoice")
        if inv:
            qs = qs.filter(invoice_id=inv)
        return qs

    def perform_create(self, serializer):
        if not user_can_manage_finance(self.request.user):
            raise PermissionDenied()
        invoice = serializer.validated_data["invoice"]
        if invoice.status != Invoice.Status.DRAFT:
            raise ValidationError({"detail": "Lines can only be added to draft invoices."})
        serializer.save()

    def perform_update(self, serializer):
        if not user_can_manage_finance(self.request.user):
            raise PermissionDenied()
        if serializer.instance.invoice.status != Invoice.Status.DRAFT:
            raise ValidationError({"detail": "Only draft invoice lines can be updated."})
        serializer.save()

    def perform_destroy(self, instance):
        if not user_can_manage_finance(self.request.user):
            raise PermissionDenied()
        if instance.invoice.status != Invoice.Status.DRAFT:
            raise ValidationError({"detail": "Only draft invoice lines can be deleted."})
        super().perform_destroy(instance)


class PaymentViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = PaymentSerializer

    def get_queryset(self):
        return _payments_for(self.request.user)
