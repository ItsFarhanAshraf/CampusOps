"""Campus role names stored as Django auth Group names."""

ROLE_STUDENT = "student"
ROLE_FACULTY = "faculty"
ROLE_STAFF = "staff"
ROLE_CAMPUS_ADMINISTRATOR = "campus_administrator"

DEFAULT_GROUP_NAMES = (
    ROLE_STUDENT,
    ROLE_FACULTY,
    ROLE_STAFF,
    ROLE_CAMPUS_ADMINISTRATOR,
)

ROLE_CHOICES = (
    (ROLE_STUDENT, "Student"),
    (ROLE_FACULTY, "Faculty"),
    (ROLE_STAFF, "Staff"),
    (ROLE_CAMPUS_ADMINISTRATOR, "Campus administrator"),
)
