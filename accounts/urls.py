from django.urls import path

from accounts import views

urlpatterns = [
    path("auth/register/", views.RegisterView.as_view(), name="auth-register"),
    path("auth/token/", views.CampusTokenObtainPairView.as_view(), name="auth-token"),
    path("auth/token/refresh/", views.CampusTokenRefreshView.as_view(), name="auth-token-refresh"),
    path("auth/me/", views.MeView.as_view(), name="auth-me"),
    path("auth/admin/ping/", views.AdminPingView.as_view(), name="auth-admin-ping"),
]
