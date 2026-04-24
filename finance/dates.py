import calendar
from datetime import date, timedelta


def add_months(start: date, months: int) -> date:
    """Return ``start`` shifted forward by ``months`` (calendar-aware)."""
    if months == 0:
        return start
    year = start.year
    month = start.month - 1 + months
    year += month // 12
    month = month % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    day = min(start.day, last_day)
    return date(year, month, day)


def next_due_date(start: date, frequency: str, step_index: int) -> date:
    """``step_index`` is 0-based offset from the first installment due date."""
    if frequency == "weekly":
        return start + timedelta(weeks=step_index)
    return add_months(start, step_index)
