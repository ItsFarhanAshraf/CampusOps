from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

User = settings.AUTH_USER_MODEL


class Course(models.Model):
    code = models.CharField(max_length=32)
    title = models.CharField(max_length=255)
    term = models.CharField(max_length=64, blank=True, default="")
    instructor = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="courses_teaching",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["code", "term"]
        constraints = [
            models.UniqueConstraint(
                fields=["code", "term"],
                name="academic_course_unique_code_term",
            ),
        ]

    def __str__(self) -> str:
        suffix = f" ({self.term})" if self.term else ""
        return f"{self.code}{suffix}"


class Enrollment(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        DROPPED = "dropped", "Dropped"

    course = models.ForeignKey(
        Course,
        on_delete=models.CASCADE,
        related_name="enrollments",
    )
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="enrollments",
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    enrolled_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["course", "student"],
                name="academic_enrollment_unique_course_student",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.student.email} → {self.course}"


class Attendance(models.Model):
    class Status(models.TextChoices):
        PRESENT = "present", "Present"
        ABSENT = "absent", "Absent"
        LATE = "late", "Late"
        EXCUSED = "excused", "Excused"

    course = models.ForeignKey(
        Course,
        on_delete=models.CASCADE,
        related_name="attendance_records",
    )
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="attendance_records",
    )
    session_date = models.DateField()
    status = models.CharField(max_length=16, choices=Status.choices)
    notes = models.CharField(max_length=255, blank=True, default="")
    recorded_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attendance_recorded",
    )
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-session_date", "course__code"]
        constraints = [
            models.UniqueConstraint(
                fields=["course", "student", "session_date"],
                name="academic_attendance_unique_session",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.student.email} @ {self.course.code} {self.session_date}"


class Grade(models.Model):
    class Category(models.TextChoices):
        ASSIGNMENT = "assignment", "Assignment"
        QUIZ = "quiz", "Quiz"
        MIDTERM = "midterm", "Midterm"
        FINAL = "final", "Final"
        PROJECT = "project", "Project"
        OTHER = "other", "Other"

    course = models.ForeignKey(
        Course,
        on_delete=models.CASCADE,
        related_name="grades",
    )
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="grades",
    )
    category = models.CharField(
        max_length=32,
        choices=Category.choices,
        default=Category.OTHER,
    )
    title = models.CharField(max_length=128)
    max_points = models.DecimalField(
        max_digits=7,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
    )
    score = models.DecimalField(
        max_digits=7,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["course", "student", "category", "title"],
                name="academic_grade_unique_assessment",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.student.email} {self.course.code} {self.title}"
