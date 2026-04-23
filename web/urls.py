from django.urls import path

from web import views

urlpatterns = [
    path("", views.HomeRedirectView.as_view(), name="web-home"),
    path("app/login/", views.LoginView.as_view(), name="web-login"),
    path("app/signup/", views.SignupView.as_view(), name="web-signup"),
    path("app/dashboard/", views.DashboardView.as_view(), name="web-dashboard"),
]
