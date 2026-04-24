from django.urls import include, path
from rest_framework.routers import DefaultRouter

from finance import views

router = DefaultRouter()
router.register(r"fee-structures", views.FeeStructureViewSet, basename="fee-structure")
router.register(r"invoices", views.InvoiceViewSet, basename="invoice")
router.register(r"invoice-lines", views.InvoiceLineViewSet, basename="invoice-line")
router.register(r"payments", views.PaymentViewSet, basename="payment")

urlpatterns = [
    path("", include(router.urls)),
]
