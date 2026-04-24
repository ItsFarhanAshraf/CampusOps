from django.contrib import admin

from finance.models import FeeStructure, Invoice, InvoiceLine, Payment


class InvoiceLineInline(admin.TabularInline):
    model = InvoiceLine
    extra = 0


@admin.register(FeeStructure)
class FeeStructureAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "amount", "term", "is_active", "updated_at")
    search_fields = ("code", "name", "term")
    list_filter = ("is_active", "term")


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "status", "due_date", "currency", "issued_at", "created_at")
    list_filter = ("status", "currency")
    search_fields = ("student__email", "notes")
    inlines = [InvoiceLineInline]


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("id", "invoice", "amount", "method", "status", "created_at")
    list_filter = ("method", "status")
    search_fields = ("reference", "invoice__student__email")
