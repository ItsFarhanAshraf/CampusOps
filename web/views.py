from django.views.generic import RedirectView, TemplateView


class HomeRedirectView(RedirectView):
    pattern_name = "web-login"
    permanent = False


class LoginView(TemplateView):
    template_name = "web/login.html"


class SignupView(TemplateView):
    template_name = "web/signup.html"


class DashboardView(TemplateView):
    template_name = "web/dashboard.html"
