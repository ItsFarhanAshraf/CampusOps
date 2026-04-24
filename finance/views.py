from datetime import timedelta
from io import BytesIO

from django.http import FileResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from finance.models import FeeStructure, InstallmentPlan, Invoice, InvoiceLine, Payment
from finance.pdf import build_invoice_pdf
from finance.permissions import ReadAuthenticatedOrFinanceManageWrite, user_can_manage_finance
from finance.serializers import (
    FeeStructureSerializer,
    InitiatePendingPaymentSerializer,
    InstallmentPlanCreateSerializer,
    InstallmentPlanSerializer,
    InvoiceCreateSerializer,
    InvoiceSerializer,
    InvoiceUpdateSerializer,
    InvoiceLineSerializer,
    PaymentSerializer,
    RecordPaymentSerializer,
)
from finance.services import (
    cancel_pending_payment,
    confirm_pending_payment,
    create_installment_plan,
    initiate_pending_payment,
    issue_invoice,
    record_payment,
    void_invoice,
)


def _invoices_for(user):
    qs = (
        Invoice.objects.select_related("student", "installment_plan")
        .prefetch_related("lines", "payments")
        .order_by("-created_at")
    )
    if user.is_superuser or user.is_staff or user_can_manage_finance(user):
        return qs
    return qs.filter(student=user)


def _lines_for(user):
    qs = InvoiceLine.objects.select_related("invoice", "fee_structure")
    if user.is_superuser or user.is_staff or user_can_manage_finance(user):
        return qs
    return qs.filter(invoice__student=user)


def _payments_for(user):
    qs = Payment.objects.select_related("invoice", "recorded_by").order_by("-created_at")
    if user.is_superuser or user.is_staff or user_can_manage_finance(user):
        return qs
    return qs.filter(invoice__student=user)


def _installment_plans_for(user):
    qs = InstallmentPlan.objects.select_related("invoice").prefetch_related("installments")
    if user.is_superuser or user.is_staff or user_can_manage_finance(user):
        return qs
    return qs.filter(invoice__student=user)


def _can_initiate_pending(user, invoice: Invoice) -> bool:
    if user_can_manage_finance(user):
        return True
    return invoice.student_id == user.id


def _can_confirm_pending(user, payment: Payment) -> bool:
    if user_can_manage_finance(user):
        return True
    return payment.invoice.student_id == user.id


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

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        invoice = self.get_object()
        data = build_invoice_pdf(invoice)
        buffer = BytesIO(data)
        return FileResponse(
            buffer,
            as_attachment=True,
            filename=f"invoice-{invoice.pk}.pdf",
            content_type="application/pdf",
        )

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
        inv.refresh_from_db(fields=["status", "updated_at"])
        return Response(
            {
                "invoice": InvoiceSerializer(inv, context={"request": request}).data,
                "payment": PaymentSerializer(payment, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="initiate-pending-payment")
    def initiate_pending_payment(self, request, pk=None):
        invoice = self.get_object()
        if not _can_initiate_pending(request.user, invoice):
            raise PermissionDenied()
        ser = InitiatePendingPaymentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        hours = ser.validated_data.get("expires_in_hours", 24)
        expires_at = timezone.now() + timedelta(hours=hours)
        try:
            inv, payment = initiate_pending_payment(
                invoice=invoice,
                amount=ser.validated_data["amount"],
                method=ser.validated_data["method"],
                reference=ser.validated_data.get("reference", ""),
                client_reference=ser.validated_data.get("client_reference", ""),
                user=request.user,
                expires_at=expires_at,
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

    @action(detail=True, methods=["post"], url_path="create-installment-plan")
    def create_installment_plan(self, request, pk=None):
        if not user_can_manage_finance(request.user):
            raise PermissionDenied()
        invoice = self.get_object()
        ser = InstallmentPlanCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            plan = create_installment_plan(
                invoice=invoice,
                num_installments=ser.validated_data["num_installments"],
                first_due_date=ser.validated_data["first_due_date"],
                frequency=ser.validated_data["frequency"],
                title=ser.validated_data.get("title", ""),
            )
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        plan = InstallmentPlan.objects.select_related("invoice").prefetch_related("installments").get(
            pk=plan.pk,
        )
        return Response(
            InstallmentPlanSerializer(plan, context={"request": request}).data,
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
        qs = _payments_for(self.request.user)
        st = self.request.query_params.get("status")
        if st:
            qs = qs.filter(status=st)
        return qs

    @action(detail=True, methods=["post"], url_path="confirm")
    def confirm(self, request, pk=None):
        payment = self.get_object()
        if not _can_confirm_pending(request.user, payment):
            raise PermissionDenied()
        try:
            inv, pay = confirm_pending_payment(payment=payment)
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        inv.refresh_from_db(fields=["status", "updated_at"])
        return Response(
            {
                "invoice": InvoiceSerializer(inv, context={"request": request}).data,
                "payment": PaymentSerializer(pay, context={"request": request}).data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        if not user_can_manage_finance(request.user):
            raise PermissionDenied()
        payment = self.get_object()
        try:
            pay = cancel_pending_payment(payment=payment)
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            PaymentSerializer(pay, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


class InstallmentPlanViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = InstallmentPlanSerializer

    def get_queryset(self):
        return _installment_plans_for(self.request.user)
