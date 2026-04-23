from django.contrib import admin

from academic.models import Attendance, Course, Enrollment, Grade


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ("code", "title", "term", "instructor", "created_at")
    search_fields = ("code", "title", "term", "instructor__email")
    list_filter = ("term",)


@admin.register(Enrollment)
class EnrollmentAdmin(admin.ModelAdmin):
    list_display = ("course", "student", "status", "enrolled_at")
    list_filter = ("status",)
    search_fields = ("course__code", "student__email")


@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = ("course", "student", "session_date", "status", "recorded_by")
    list_filter = ("status", "session_date")
    search_fields = ("course__code", "student__email")


@admin.register(Grade)
class GradeAdmin(admin.ModelAdmin):
    list_display = ("course", "student", "category", "title", "score", "max_points")
    list_filter = ("category",)
    search_fields = ("course__code", "student__email", "title")
