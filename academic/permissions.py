from rest_framework import permissions

MANAGE_ACADEMIC_GROUPS = frozenset(
    {"faculty", "staff", "campus_administrator"},
)


def user_can_manage_academic(user) -> bool:
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_staff:
        return True
    return user.groups.filter(name__in=MANAGE_ACADEMIC_GROUPS).exists()


class ReadAuthenticatedOrManageWrite(permissions.BasePermission):
    """GET/HEAD/OPTIONS for any authenticated user; mutations only for academic managers."""

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return user_can_manage_academic(request.user)


class EnrollmentPermission(permissions.BasePermission):
    """List/retrieve/create for authenticated users (self-enrollment on create); updates/deletes for managers only."""

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        if request.method == "POST":
            return True
        return user_can_manage_academic(request.user)
