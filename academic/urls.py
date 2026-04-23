from django.urls import include, path
from rest_framework.routers import DefaultRouter

from academic import views

router = DefaultRouter()
router.register(r"courses", views.CourseViewSet, basename="course")
router.register(r"enrollments", views.EnrollmentViewSet, basename="enrollment")
router.register(r"attendance", views.AttendanceViewSet, basename="attendance")
router.register(r"grades", views.GradeViewSet, basename="grade")
router.register(r"reports", views.ReportViewSet, basename="report")

urlpatterns = [
    path("", include(router.urls)),
]
