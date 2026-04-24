from rest_framework import permissions

MANAGE_FINANCE_GROUPS = frozenset(
    {"staff", "campus_administrator", "finance"},
)


def user_can_manage_finance(user) -> bool:
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_staff:
        return True
    return user.groups.filter(name__in=MANAGE_FINANCE_GROUPS).exists()


class ReadAuthenticatedOrFinanceManageWrite(permissions.BasePermission):
    """Authenticated reads; finance managers for mutations."""

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return user_can_manage_finance(request.user)
