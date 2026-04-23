from collections.abc import Iterable

from rest_framework import permissions

from accounts import roles


class IsInGroups(permissions.BasePermission):
    """Allow only users who belong to at least one of the named Django groups."""

    def __init__(self, group_names: Iterable[str]):
        self.group_names = set(group_names)

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return user.groups.filter(name__in=self.group_names).exists()


class IsCampusAdministrator(permissions.BasePermission):
    def has_permission(self, request, view) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return (
            user.groups.filter(name=roles.ROLE_CAMPUS_ADMINISTRATOR).exists()
            or user.is_superuser
        )
