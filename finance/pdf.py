"""Generate simple PDF invoices using ReportLab."""

from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from finance.models import Invoice
from finance.services import invoice_amount_paid, invoice_amount_pending, invoice_line_total


def build_invoice_pdf(invoice: Invoice) -> bytes:
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        title=f"Invoice-{invoice.pk}",
        leftMargin=36,
        rightMargin=36,
        topMargin=48,
        bottomMargin=48,
    )
    styles = getSampleStyleSheet()
    story = []

    story.append(Paragraph("CampusOps — Invoice", styles["Title"]))
    story.append(Spacer(1, 12))
    story.append(
        Paragraph(
            f"<b>Invoice #:</b> {invoice.pk}<br/>"
            f"<b>Student:</b> {invoice.student.email}<br/>"
            f"<b>Status:</b> {invoice.get_status_display()}<br/>"
            f"<b>Due date:</b> {invoice.due_date.isoformat()}<br/>"
            f"<b>Currency:</b> {invoice.currency}",
            styles["Normal"],
        ),
    )
    story.append(Spacer(1, 16))

    line_total = invoice_line_total(invoice)
    paid = invoice_amount_paid(invoice)
    pending = invoice_amount_pending(invoice)
    balance = line_total - paid

    story.append(
        Paragraph(
            f"<b>Line total:</b> {line_total} {invoice.currency}<br/>"
            f"<b>Paid (completed):</b> {paid} {invoice.currency}<br/>"
            f"<b>Pending holds:</b> {pending} {invoice.currency}<br/>"
            f"<b>Remaining after completed:</b> {balance} {invoice.currency}",
            styles["Normal"],
        ),
    )
    story.append(Spacer(1, 16))

    if invoice.notes:
        story.append(Paragraph(f"<b>Notes:</b> {invoice.notes}", styles["Normal"]))
        story.append(Spacer(1, 12))

    data = [["Description", "Qty", "Unit", "Amount"]]
    for line in invoice.lines.all().order_by("id"):
        data.append(
            [
                line.label,
                str(line.quantity),
                str(line.unit_price),
                str(line.amount),
            ],
        )

    table = Table(data, repeatRows=1, colWidths=[260, 60, 80, 80])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.HexColor("#f3f4f6")]),
            ],
        ),
    )
    story.append(table)

    doc.build(story)
    pdf = buffer.getvalue()
    buffer.close()
    return pdf
