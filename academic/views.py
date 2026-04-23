from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from academic.models import Attendance, Course, Enrollment, Grade
from academic.permissions import (
    EnrollmentPermission,
    ReadAuthenticatedOrManageWrite,
    user_can_manage_academic,
)
from academic.serializers import (
    AttendanceSerializer,
    CourseSerializer,
    EnrollmentSerializer,
    GradeSerializer,
)


def _user_in_groups(user, names: set[str]) -> bool:
    return user.groups.filter(name__in=names).exists()


def _courses_visible_to(user):
    if user.is_superuser or user.is_staff or _user_in_groups(
        user,
        {"campus_administrator", "staff"},
    ):
        return Course.objects.all()
    if _user_in_groups(user, {"faculty"}):
        return Course.objects.filter(
            Q(instructor=user)
            | Q(
                enrollments__student=user,
                enrollments__status=Enrollment.Status.ACTIVE,
            ),
        ).distinct()
    return Course.objects.filter(
        enrollments__student=user,
        enrollments__status=Enrollment.Status.ACTIVE,
    ).distinct()


def _can_view_course_reports(user, course: Course) -> bool:
    if user.is_superuser or user.is_staff:
        return True
    if _user_in_groups(user, {"campus_administrator", "staff"}):
        return True
    return course.instructor_id == user.id


class CourseViewSet(viewsets.ModelViewSet):
    permission_classes = [ReadAuthenticatedOrManageWrite]
    serializer_class = CourseSerializer

    def get_queryset(self):
        return _courses_visible_to(self.request.user).select_related("instructor")

    def perform_create(self, serializer):
        user = self.request.user
        if not user_can_manage_academic(user):
            raise PermissionDenied("You cannot create courses.")
        if not serializer.validated_data.get("instructor"):
            serializer.save(instructor=user)
        else:
            serializer.save()


class EnrollmentViewSet(viewsets.ModelViewSet):
    permission_classes = [EnrollmentPermission]
    serializer_class = EnrollmentSerializer

    def get_queryset(self):
        user = self.request.user
        base = Enrollment.objects.select_related("course", "student")
        if user.is_superuser or user.is_staff or _user_in_groups(
            user,
            {"campus_administrator", "staff"},
        ):
            qs = base
        elif _user_in_groups(user, {"faculty"}):
            qs = base.filter(
                Q(course__instructor=user) | Q(student=user),
            ).distinct()
        else:
            qs = base.filter(student=user)
        course_id = self.request.query_params.get("course")
        if course_id:
            qs = qs.filter(course_id=course_id)
        return qs

    def perform_create(self, serializer):
        serializer.save()


class AttendanceViewSet(viewsets.ModelViewSet):
    permission_classes = [ReadAuthenticatedOrManageWrite]
    serializer_class = AttendanceSerializer

    def get_queryset(self):
        user = self.request.user
        qs = Attendance.objects.select_related("course", "student", "recorded_by")
        if user.is_superuser or user.is_staff or _user_in_groups(
            user,
            {"campus_administrator", "staff"},
        ):
            pass
        elif _user_in_groups(user, {"faculty"}):
            qs = qs.filter(Q(course__instructor=user) | Q(student=user)).distinct()
        else:
            qs = qs.filter(student=user)
        course_id = self.request.query_params.get("course")
        if course_id:
            qs = qs.filter(course_id=course_id)
        return qs


class GradeViewSet(viewsets.ModelViewSet):
    permission_classes = [ReadAuthenticatedOrManageWrite]
    serializer_class = GradeSerializer

    def get_queryset(self):
        user = self.request.user
        qs = Grade.objects.select_related("course", "student")
        if user.is_superuser or user.is_staff or _user_in_groups(
            user,
            {"campus_administrator", "staff"},
        ):
            pass
        elif _user_in_groups(user, {"faculty"}):
            qs = qs.filter(Q(course__instructor=user) | Q(student=user)).distinct()
        else:
            qs = qs.filter(student=user)
        course_id = self.request.query_params.get("course")
        if course_id:
            qs = qs.filter(course_id=course_id)
        return qs


class ReportViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["get"], url_path="attendance-summary")
    def attendance_summary(self, request):
        course_id = request.query_params.get("course")
        if not course_id:
            raise ValidationError({"course": "This query parameter is required."})
        course = get_object_or_404(Course, pk=course_id)
        if not _can_view_course_reports(request.user, course):
            raise PermissionDenied("You cannot view attendance reports for this course.")
        qs = Attendance.objects.filter(course=course)
        date_from = request.query_params.get("from")
        date_to = request.query_params.get("to")
        if date_from:
            qs = qs.filter(session_date__gte=date_from)
        if date_to:
            qs = qs.filter(session_date__lte=date_to)
        rows = list(
            qs.values("status")
            .annotate(count=Count("id"))
            .order_by("status"),
        )
        by_status = {r["status"]: r["count"] for r in rows}
        total = sum(by_status.values())
        return Response(
            {
                "course": course.id,
                "course_code": course.code,
                "from": date_from,
                "to": date_to,
                "total_records": total,
                "by_status": by_status,
            },
        )

    @action(detail=False, methods=["get"], url_path="grades-summary")
    def grades_summary(self, request):
        course_id = request.query_params.get("course")
        if not course_id:
            raise ValidationError({"course": "This query parameter is required."})
        course = get_object_or_404(Course, pk=course_id)
        if not _can_view_course_reports(request.user, course):
            raise PermissionDenied("You cannot view grade reports for this course.")
        qs = Grade.objects.filter(course=course)
        totals = qs.aggregate(total_score=Sum("score"), total_max=Sum("max_points"))
        overall = None
        ts, tm = totals["total_score"], totals["total_max"]
        if ts is not None and tm and tm > 0:
            overall = float((ts / tm) * 100)
        per_student = (
            qs.values("student", "student__email")
            .annotate(
                total_score=Sum("score"),
                total_max=Sum("max_points"),
            )
            .order_by("student__email")
        )
        students = []
        for row in per_student:
            total_max = row["total_max"] or Decimal("0")
            total_score = row["total_score"] or Decimal("0")
            pct = None
            if total_max > 0:
                pct = float((total_score / total_max) * 100)
            students.append(
                {
                    "student": row["student"],
                    "email": row["student__email"],
                    "total_score": str(total_score),
                    "total_max": str(total_max),
                    "percent": pct,
                },
            )
        return Response(
            {
                "course": course.id,
                "course_code": course.code,
                "overall_weighted_percent": overall,
                "per_student": students,
            },
        )
