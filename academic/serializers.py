from datetime import date

from django.utils import timezone
from rest_framework import serializers

from django.contrib.auth import get_user_model

from academic.models import Attendance, Course, Enrollment, Grade
from academic.permissions import user_can_manage_academic

User = get_user_model()


class CourseSerializer(serializers.ModelSerializer):
    instructor_email = serializers.EmailField(source="instructor.email", read_only=True)

    class Meta:
        model = Course
        fields = (
            "id",
            "code",
            "title",
            "term",
            "instructor",
            "instructor_email",
            "created_at",
        )
        read_only_fields = ("created_at", "instructor_email")
        extra_kwargs = {"instructor": {"required": False}}

    def validate_code(self, value: str) -> str:
        v = value.strip().upper()
        if len(v) < 2:
            raise serializers.ValidationError("Course code is too short.")
        return v

    def validate_title(self, value: str) -> str:
        v = value.strip()
        if not v:
            raise serializers.ValidationError("Title is required.")
        return v

class EnrollmentSerializer(serializers.ModelSerializer):
    student = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        required=False,
    )
    student_email = serializers.EmailField(source="student.email", read_only=True)
    course_code = serializers.CharField(source="course.code", read_only=True)

    class Meta:
        model = Enrollment
        fields = (
            "id",
            "course",
            "student",
            "student_email",
            "course_code",
            "status",
            "enrolled_at",
        )
        read_only_fields = ("enrolled_at", "student_email", "course_code")

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        course = attrs.get("course")
        student = attrs.get("student")
        if user and student is None:
            attrs["student"] = user
            student = user
        if user and not user_can_manage_academic(user):
            if student != user:
                raise serializers.ValidationError(
                    {"student": "Students can only enroll themselves."},
                )
        if course and student:
            dup = Enrollment.objects.filter(
                course=course,
                student=student,
                status=Enrollment.Status.ACTIVE,
            )
            if self.instance:
                dup = dup.exclude(pk=self.instance.pk)
            if dup.exists():
                raise serializers.ValidationError(
                    {"course": "Student is already actively enrolled in this course."},
                )
        return attrs


class AttendanceSerializer(serializers.ModelSerializer):
    student_email = serializers.EmailField(source="student.email", read_only=True)
    course_code = serializers.CharField(source="course.code", read_only=True)

    class Meta:
        model = Attendance
        fields = (
            "id",
            "course",
            "student",
            "student_email",
            "course_code",
            "session_date",
            "status",
            "notes",
            "recorded_by",
            "recorded_at",
        )
        read_only_fields = (
            "recorded_by",
            "recorded_at",
            "student_email",
            "course_code",
        )

    def validate_session_date(self, value: date) -> date:
        if value > timezone.now().date():
            raise serializers.ValidationError("Session date cannot be in the future.")
        return value

    def validate(self, attrs):
        course = attrs.get("course") or getattr(self.instance, "course", None)
        student = attrs.get("student") or getattr(self.instance, "student", None)
        session_date = attrs.get("session_date") or getattr(
            self.instance,
            "session_date",
            None,
        )
        if course and student and session_date:
            if not course.enrollments.filter(
                student=student,
                status=Enrollment.Status.ACTIVE,
            ).exists():
                raise serializers.ValidationError(
                    {"student": "Student must have an active enrollment in this course."},
                )
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        validated_data["recorded_by"] = user if user and user.is_authenticated else None
        return super().create(validated_data)


class GradeSerializer(serializers.ModelSerializer):
    student_email = serializers.EmailField(source="student.email", read_only=True)
    course_code = serializers.CharField(source="course.code", read_only=True)
    percentage = serializers.SerializerMethodField()

    class Meta:
        model = Grade
        fields = (
            "id",
            "course",
            "student",
            "student_email",
            "course_code",
            "category",
            "title",
            "max_points",
            "score",
            "percentage",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "student_email",
            "course_code",
            "percentage",
            "created_at",
            "updated_at",
        )

    def get_percentage(self, obj: Grade) -> float | None:
        if obj.max_points and obj.max_points > 0:
            return float((obj.score / obj.max_points) * 100)
        return None

    def validate_title(self, value: str) -> str:
        v = value.strip()
        if not v:
            raise serializers.ValidationError("Title is required.")
        return v

    def validate(self, attrs):
        inst = self.instance
        max_points = attrs.get("max_points", getattr(inst, "max_points", None))
        score = attrs.get("score", getattr(inst, "score", None))
        if max_points is not None and max_points <= 0:
            raise serializers.ValidationError(
                {"max_points": "Maximum points must be greater than zero."},
            )
        if max_points is not None and score is not None and score > max_points:
            raise serializers.ValidationError(
                {"score": "Score cannot exceed max_points."},
            )
        course = attrs.get("course") or getattr(self.instance, "course", None)
        student = attrs.get("student") or getattr(self.instance, "student", None)
        if course and student:
            if not course.enrollments.filter(
                student=student,
                status=Enrollment.Status.ACTIVE,
            ).exists():
                raise serializers.ValidationError(
                    {"student": "Student must have an active enrollment in this course."},
                )
        return attrs
