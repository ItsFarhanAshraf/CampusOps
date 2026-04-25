from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from academic.models import Attendance, Course, Enrollment, Grade
from accounts.roles import (
    DEFAULT_GROUP_NAMES,
    ROLE_CAMPUS_ADMINISTRATOR,
    ROLE_FACULTY,
    ROLE_STAFF,
    ROLE_STUDENT,
)
from finance.models import FeeStructure, Invoice, InvoiceLine, Installment, InstallmentPlan, Payment
from finance.services import (
    allocatable_remaining,
    confirm_pending_payment,
    create_installment_plan,
    initiate_pending_payment,
    issue_invoice,
    record_payment,
)


User = get_user_model()


@dataclass(frozen=True)
class DemoUserSpec:
    email: str
    password: str
    first_name: str
    last_name: str
    campus_id: str
    groups: tuple[str, ...]
    is_staff: bool = False
    is_superuser: bool = False


class Command(BaseCommand):
    help = "Seed 5 demo rows per model (safe to run multiple times)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            default="Pass1234!",
            help="Password to set for demo users (default: Pass1234!).",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        pw = options["password"]

        self.stdout.write(self.style.MIGRATE_HEADING("Seeding demo data…"))

        groups = self._ensure_groups()
        demo_users = self._ensure_users(pw, groups)

        faculty = [u for u in demo_users if u.groups.filter(name=ROLE_FACULTY).exists()]
        students = [u for u in demo_users if u.groups.filter(name=ROLE_STUDENT).exists()]
        staff = [u for u in demo_users if u.groups.filter(name=ROLE_STAFF).exists()]
        admins = [u for u in demo_users if u.groups.filter(name=ROLE_CAMPUS_ADMINISTRATOR).exists()]
        finance_managers = [u for u in demo_users if u.groups.filter(name="finance").exists()]

        actor = (
            (finance_managers[0] if finance_managers else None)
            or (admins[0] if admins else None)
            or (staff[0] if staff else None)
            or demo_users[0]
        )

        courses = self._ensure_courses(faculty=faculty)
        enrollments = self._ensure_enrollments(students=students, courses=courses)
        self._ensure_attendance(enrollments=enrollments, recorded_by=actor)
        self._ensure_grades(enrollments=enrollments)

        fees = self._ensure_fee_structures()
        invoices = self._ensure_invoices(students=students, fees=fees)
        self._ensure_invoice_lines(invoices=invoices, fees=fees)
        self._ensure_invoice_states_and_payments(invoices=invoices, actor=actor)
        self._ensure_installments(invoices=invoices)

        self.stdout.write(self.style.SUCCESS("Demo seed complete."))
        self._print_counts()

    def _ensure_groups(self) -> dict[str, Group]:
        wanted = list(DEFAULT_GROUP_NAMES) + ["finance"]
        out: dict[str, Group] = {}
        for name in wanted:
            out[name], _ = Group.objects.get_or_create(name=name)
        return out

    def _ensure_users(self, password: str, groups: dict[str, Group]) -> list[User]:
        specs = [
            DemoUserSpec(
                email="admin@campusops.local",
                password=password,
                first_name="Campus",
                last_name="Admin",
                campus_id="ADM-0001",
                groups=(ROLE_CAMPUS_ADMINISTRATOR,),
                is_staff=True,
            ),
            DemoUserSpec(
                email="finance@campusops.local",
                password=password,
                first_name="Finance",
                last_name="Manager",
                campus_id="FIN-0001",
                groups=("finance",),
            ),
            DemoUserSpec(
                email="staff@campusops.local",
                password=password,
                first_name="Ops",
                last_name="Staff",
                campus_id="STF-0001",
                groups=(ROLE_STAFF,),
            ),
            DemoUserSpec(
                email="faculty1@campusops.local",
                password=password,
                first_name="Ayesha",
                last_name="Khan",
                campus_id="FAC-0001",
                groups=(ROLE_FACULTY,),
            ),
            DemoUserSpec(
                email="faculty2@campusops.local",
                password=password,
                first_name="Ali",
                last_name="Raza",
                campus_id="FAC-0002",
                groups=(ROLE_FACULTY,),
            ),
            DemoUserSpec(
                email="student1@campusops.local",
                password=password,
                first_name="Sara",
                last_name="Ahmed",
                campus_id="STD-0001",
                groups=(ROLE_STUDENT,),
            ),
            DemoUserSpec(
                email="student2@campusops.local",
                password=password,
                first_name="Hassan",
                last_name="Iqbal",
                campus_id="STD-0002",
                groups=(ROLE_STUDENT,),
            ),
            DemoUserSpec(
                email="student3@campusops.local",
                password=password,
                first_name="Fatima",
                last_name="Noor",
                campus_id="STD-0003",
                groups=(ROLE_STUDENT,),
            ),
            DemoUserSpec(
                email="student4@campusops.local",
                password=password,
                first_name="Usman",
                last_name="Shah",
                campus_id="STD-0004",
                groups=(ROLE_STUDENT,),
            ),
            DemoUserSpec(
                email="student5@campusops.local",
                password=password,
                first_name="Zainab",
                last_name="Iqbal",
                campus_id="STD-0005",
                groups=(ROLE_STUDENT,),
            ),
        ]

        users: list[User] = []
        for s in specs:
            user, created = User.objects.get_or_create(
                email=s.email,
                defaults={
                    "first_name": s.first_name,
                    "last_name": s.last_name,
                    "campus_id": s.campus_id,
                    "is_staff": s.is_staff,
                    "is_superuser": s.is_superuser,
                },
            )
            if created:
                user.set_password(s.password)
                user.save(update_fields=["password"])

            # ensure groups
            for g in s.groups:
                user.groups.add(groups[g])
            users.append(user)

        return users

    def _ensure_courses(self, *, faculty: list[User]) -> list[Course]:
        if not faculty:
            raise RuntimeError("No faculty users found/created.")

        specs = [
            ("CS101", "Intro to Computing", "Spring 2026", faculty[0]),
            ("CS102", "Programming Fundamentals", "Spring 2026", faculty[0]),
            ("CS201", "Data Structures", "Spring 2026", faculty[1 % len(faculty)]),
            ("CS202", "Databases", "Spring 2026", faculty[1 % len(faculty)]),
            ("CS301", "Software Engineering", "Spring 2026", faculty[0]),
        ]

        out: list[Course] = []
        for code, title, term, instr in specs:
            c, _ = Course.objects.get_or_create(
                code=code,
                term=term,
                defaults={"title": title, "instructor": instr},
            )
            out.append(c)
        return out

    def _ensure_enrollments(self, *, students: list[User], courses: list[Course]) -> list[Enrollment]:
        if len(students) < 5:
            raise RuntimeError("Need at least 5 student users.")

        pairs = [
            (students[0], courses[0]),
            (students[1], courses[1]),
            (students[2], courses[2]),
            (students[3], courses[3]),
            (students[4], courses[4]),
        ]
        out: list[Enrollment] = []
        for student, course in pairs:
            e, _ = Enrollment.objects.get_or_create(course=course, student=student)
            out.append(e)
        return out

    def _ensure_attendance(self, *, enrollments: list[Enrollment], recorded_by: User) -> None:
        today = timezone.now().date()
        for idx, e in enumerate(enrollments[:5]):
            session_date = today - timedelta(days=(idx + 1))
            status = [
                Attendance.Status.PRESENT,
                Attendance.Status.LATE,
                Attendance.Status.ABSENT,
                Attendance.Status.EXCUSED,
                Attendance.Status.PRESENT,
            ][idx]
            Attendance.objects.get_or_create(
                course=e.course,
                student=e.student,
                session_date=session_date,
                defaults={
                    "status": status,
                    "notes": f"Demo record {idx + 1}",
                    "recorded_by": recorded_by,
                },
            )

    def _ensure_grades(self, *, enrollments: list[Enrollment]) -> None:
        for idx, e in enumerate(enrollments[:5]):
            Grade.objects.get_or_create(
                course=e.course,
                student=e.student,
                category=[Grade.Category.QUIZ, Grade.Category.ASSIGNMENT, Grade.Category.MIDTERM, Grade.Category.FINAL, Grade.Category.PROJECT][
                    idx
                ],
                title=f"Assessment {idx + 1}",
                defaults={
                    "max_points": Decimal("100.00"),
                    "score": Decimal(str(65 + idx * 7)).quantize(Decimal("0.01")),
                },
            )

    def _ensure_fee_structures(self) -> list[FeeStructure]:
        specs = [
            ("TUITION", "Tuition Fee", Decimal("1200.00"), "Spring 2026"),
            ("HOSTEL", "Hostel Fee", Decimal("400.00"), "Spring 2026"),
            ("EXAM", "Exam Fee", Decimal("75.00"), "Spring 2026"),
            ("LIB", "Library Fee", Decimal("25.00"), "Spring 2026"),
            ("SPORT", "Sports Fee", Decimal("40.00"), "Spring 2026"),
        ]
        out: list[FeeStructure] = []
        for code, name, amount, term in specs:
            f, _ = FeeStructure.objects.get_or_create(
                code=code,
                term=term,
                defaults={"name": name, "amount": amount, "is_active": True},
            )
            out.append(f)
        return out

    def _ensure_invoices(self, *, students: list[User], fees: list[FeeStructure]) -> list[Invoice]:
        today = timezone.now().date()
        out: list[Invoice] = []
        for idx in range(5):
            inv, _ = Invoice.objects.get_or_create(
                student=students[idx],
                due_date=today + timedelta(days=14 + idx),
                defaults={
                    "currency": "USD",
                    "notes": f"Demo invoice {idx + 1}",
                },
            )
            out.append(inv)
        return out

    def _ensure_invoice_lines(self, *, invoices: list[Invoice], fees: list[FeeStructure]) -> None:
        # Ensure at least 5 InvoiceLine rows total (we will create 1 per invoice).
        for idx, inv in enumerate(invoices[:5]):
            fee = fees[idx % len(fees)]
            label = f"{fee.name} ({fee.term})"
            InvoiceLine.objects.get_or_create(
                invoice=inv,
                label=label,
                defaults={
                    "fee_structure": fee,
                    "quantity": Decimal("1.00"),
                    "unit_price": fee.amount,
                    "amount": fee.amount,
                },
            )

    def _ensure_invoice_states_and_payments(self, *, invoices: list[Invoice], actor: User) -> None:
        """
        Create at least 5 Payment rows across invoices with mixed statuses.

        We intentionally keep some invoices issued/unpaid so the UI has variety.
        """
        now = timezone.now()

        # Issue all invoices that are still draft and have lines
        for inv in invoices[:5]:
            inv.refresh_from_db()
            if inv.status == Invoice.Status.DRAFT and inv.lines.exists():
                issue_invoice(invoice=inv)

        # Create payments (5 total) in a deterministic mix, but clamp to each invoice's
        # allocatable remaining so it's safe to re-run.
        def clamp_amount(inv: Invoice, desired: Decimal) -> Decimal | None:
            inv.refresh_from_db()
            remaining = allocatable_remaining(inv)
            if remaining <= 0:
                return None
            return min(desired, remaining).quantize(Decimal("0.01"))

        # 1) Completed partial payment
        inv1 = invoices[0]
        if inv1.payments.filter(reference="DEMO-PAY-1").exists() is False:
            amt = clamp_amount(inv1, Decimal("100.00"))
            if amt:
                record_payment(
                    invoice=inv1,
                    amount=amt,
                    method=Payment.Method.CASH,
                    reference="DEMO-PAY-1",
                    user=actor,
                )

        # 2) Pending payment (not yet confirmed)
        inv2 = invoices[1]
        if inv2.payments.filter(client_reference="DEMO-PENDING-2").exists() is False:
            amt = clamp_amount(inv2, Decimal("50.00"))
            if amt:
                initiate_pending_payment(
                    invoice=inv2,
                    amount=amt,
                    method=Payment.Method.CARD,
                    reference="DEMO-PAY-2",
                    client_reference="DEMO-PENDING-2",
                    user=actor,
                    expires_at=now + timedelta(hours=24),
                )

        # 3) Pending + confirmed → completed
        inv3 = invoices[2]
        if inv3.payments.filter(client_reference="DEMO-PENDING-3").exists() is False:
            amt = clamp_amount(inv3, Decimal("60.00"))
            if amt:
                _, pay = initiate_pending_payment(
                    invoice=inv3,
                    amount=amt,
                    method=Payment.Method.CARD,
                    reference="DEMO-PAY-3",
                    client_reference="DEMO-PENDING-3",
                    user=actor,
                    expires_at=now + timedelta(hours=24),
                )
                confirm_pending_payment(payment=pay)

        # 4) Another completed payment
        inv4 = invoices[3]
        if inv4.payments.filter(reference="DEMO-PAY-4").exists() is False:
            amt = clamp_amount(inv4, Decimal("80.00"))
            if amt:
                record_payment(
                    invoice=inv4,
                    amount=amt,
                    method=Payment.Method.BANK_TRANSFER,
                    reference="DEMO-PAY-4",
                    user=actor,
                )

        # 5) Completed small payment
        inv5 = invoices[4]
        if inv5.payments.filter(reference="DEMO-PAY-5").exists() is False:
            amt = clamp_amount(inv5, Decimal("25.00"))
            if amt:
                record_payment(
                    invoice=inv5,
                    amount=amt,
                    method=Payment.Method.OTHER,
                    reference="DEMO-PAY-5",
                    user=actor,
                )

    def _ensure_installments(self, *, invoices: list[Invoice]) -> None:
        """
        Ensure at least 5 InstallmentPlan rows and 5 Installment rows.

        We attach a plan to each of 5 invoices; each plan creates multiple installments.
        """
        today = timezone.now().date()
        created_plans: list[InstallmentPlan] = []
        for idx, inv in enumerate(invoices[:5]):
            inv.refresh_from_db()
            if inv.status in (Invoice.Status.DRAFT, Invoice.Status.VOID):
                continue
            if hasattr(inv, "installment_plan"):
                created_plans.append(inv.installment_plan)
                continue
            try:
                plan = create_installment_plan(
                    invoice=inv,
                    num_installments=3,
                    first_due_date=today + timedelta(days=7),
                    frequency=InstallmentPlan.Frequency.MONTHLY,
                    title=f"Demo plan {idx + 1}",
                )
                created_plans.append(plan)
            except Exception:
                # If invoice balance is 0 (paid) or pending holds prevent scheduling, skip.
                continue

        # Ensure we have at least 5 plans (create 1 extra standalone demo plan if needed).
        # This can happen if an invoice becomes fully paid (no remaining principal to schedule).
        while InstallmentPlan.objects.count() < 5:
            student = User.objects.filter(groups__name=ROLE_STUDENT).order_by("email").first()
            if not student:
                break
            inv = Invoice.objects.create(
                student=student,
                status=Invoice.Status.ISSUED,
                due_date=today + timedelta(days=45),
                currency="USD",
                notes="Extra demo invoice for installment plan.",
            )
            # Add a line so it has a balance to schedule.
            InvoiceLine.objects.create(
                invoice=inv,
                fee_structure=None,
                label="Installment demo line",
                quantity=Decimal("1.00"),
                unit_price=Decimal("150.00"),
                amount=Decimal("150.00"),
            )
            try:
                issue_invoice(invoice=inv)
            except Exception:
                pass
            try:
                create_installment_plan(
                    invoice=inv,
                    num_installments=3,
                    first_due_date=today + timedelta(days=7),
                    frequency=InstallmentPlan.Frequency.MONTHLY,
                    title="Extra demo plan",
                )
            except Exception:
                break

        # Guarantee at least 5 Installment rows exist by creating additional
        # scheduled installments on existing plans if needed.
        if Installment.objects.count() < 5:
            plan = InstallmentPlan.objects.order_by("-created_at").first()
            if plan:
                existing = set(plan.installments.values_list("sequence", flat=True))
                for s in range(1, 6):
                    if s in existing:
                        continue
                    Installment.objects.create(
                        plan=plan,
                        sequence=s,
                        due_date=today + timedelta(days=30 * s),
                        amount=Decimal("10.00"),
                        status=Installment.Status.SCHEDULED,
                    )

    def _print_counts(self) -> None:
        def row(label: str, n: int) -> None:
            self.stdout.write(f"  - {label}: {n}")

        row("User", User.objects.count())
        row("Group", Group.objects.count())
        row("Course", Course.objects.count())
        row("Enrollment", Enrollment.objects.count())
        row("Attendance", Attendance.objects.count())
        row("Grade", Grade.objects.count())
        row("FeeStructure", FeeStructure.objects.count())
        row("Invoice", Invoice.objects.count())
        row("InvoiceLine", InvoiceLine.objects.count())
        row("Payment", Payment.objects.count())
        row("InstallmentPlan", InstallmentPlan.objects.count())
        row("Installment", Installment.objects.count())

