from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from fastapi import HTTPException

from app.core.supabase import SupabaseError
from app.dependencies.supabase import get_supabase_client

DEFAULT_PLATFORM_FEE_RATE = Decimal("0.05")


def _normalize_rate(value: Any | None) -> Decimal:
    if value is None:
        return DEFAULT_PLATFORM_FEE_RATE

    try:
        return Decimal(str(value))
    except (TypeError, ValueError):
        return DEFAULT_PLATFORM_FEE_RATE


def _format_rate_record(row: dict | None) -> dict | None:
    if not row:
        return None

    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "rate": _normalize_rate(row.get("rate")),
        "effective_at": row.get("effective_at"),
        "created_at": row.get("created_at"),
        "is_active": row.get("is_active"),
    }


def _fetch_active_rate_row() -> dict | None:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "platform_fee_rates",
            query={"select": "id,name,rate,effective_at,is_active", "is_active": "eq.true", "order": "effective_at.desc"},
            use_service_role=True,
        )
    except SupabaseError:
        return None

    return rows[0] if rows else None


def _deactivate_active_rates() -> None:
    supabase = get_supabase_client()
    try:
        supabase.update(
            "platform_fee_rates",
            {"is_active": False},
            query={"is_active": "eq.true"},
            use_service_role=True,
        )
    except SupabaseError:
        pass


def get_active_platform_fee_rate_record() -> dict:
    row = _fetch_active_rate_row()
    if not row:
        return {
            "id": None,
            "name": "Default fee",
            "rate": DEFAULT_PLATFORM_FEE_RATE,
            "effective_at": None,
        }

    record = _format_rate_record(row)
    return record if record is not None else {
        "id": None,
        "name": "Default fee",
        "rate": DEFAULT_PLATFORM_FEE_RATE,
        "effective_at": None,
    }


def create_platform_fee_rate_record(
    name: str,
    rate: Any,
    effective_at: datetime | None = None,
) -> dict:
    supabase = get_supabase_client()

    normalized_rate = _normalize_rate(rate)
    _deactivate_active_rates()

    payload = {
        "name": name,
        "rate": str(normalized_rate),
        "is_active": True,
    }

    if effective_at:
        payload["effective_at"] = effective_at.isoformat()

    rows = supabase.insert("platform_fee_rates", payload, use_service_role=True)
    if isinstance(rows, list):
        row = rows[0] if rows else None
    else:
        row = rows

    formatted = _format_rate_record(row)
    if formatted:
        return formatted

    return {
        "id": None,
        "name": name,
        "rate": normalized_rate,
        "effective_at": effective_at,
        "created_at": None,
        "is_active": True,
    }


def get_active_platform_fee_rate_value() -> Decimal:
    record = get_active_platform_fee_rate_record()
    return record["rate"]


def calculate_platform_fee(amount_cents: int, rate: Decimal) -> int:
    if amount_cents <= 0 or rate <= 0:
        return 0

    fee = (Decimal(amount_cents) * rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(fee)


def _format_date(value: str | None) -> str | None:
    if not value or len(value) < 10:
        return None

    return value[:10]


def _aggregate_fee_rows(rows: list[dict[str, Any]], field: str, bucket: dict[str, Any]) -> None:
    for row in rows:
        date_key = _format_date(row.get("created_at"))
        if not date_key:
            continue

        fee = row.get("platform_fee_cents")
        if not isinstance(fee, int):
            try:
                fee = int(fee or 0)
            except (TypeError, ValueError):
                fee = 0

        bucket_entry = bucket.setdefault(date_key, {"order_fee_cents": 0, "booking_fee_cents": 0})
        if field == "order":
            bucket_entry["order_fee_cents"] += fee
        else:
            bucket_entry["booking_fee_cents"] += fee


def list_platform_fee_history(days: int = 14) -> list[dict[str, Any]]:
    if days < 1:
        days = 1
    elif days > 90:
        days = 90

    supabase = get_supabase_client()
    since = (datetime.utcnow() - timedelta(days=days)).isoformat() + "Z"
    limit = max(200, days * 25)

    try:
        order_rows = supabase.select(
            "orders",
            query={
                "select": "platform_fee_cents,created_at",
                "created_at": f"gte.{since}",
                "order": "created_at.desc",
                "limit": str(limit),
            },
            use_service_role=True,
        )
        booking_rows = supabase.select(
            "bookings",
            query={
                "select": "platform_fee_cents,created_at",
                "created_at": f"gte.{since}",
                "order": "created_at.desc",
                "limit": str(limit),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    buckets: dict[str, dict[str, int]] = {}
    _aggregate_fee_rows(order_rows, "order", buckets)
    _aggregate_fee_rows(booking_rows, "booking", buckets)

    today = datetime.utcnow().date()
    history: list[dict[str, int]] = []
    for delta in reversed(range(days)):
        day = today - timedelta(days=delta)
        entry = buckets.get(day.isoformat(), {"order_fee_cents": 0, "booking_fee_cents": 0})
        history.append(
            {
                "date": day.isoformat(),
                "order_fee_cents": entry["order_fee_cents"],
                "booking_fee_cents": entry["booking_fee_cents"],
            }
        )

    return history
