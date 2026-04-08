from datetime import datetime, timedelta

from fastapi import HTTPException

from app.core.supabase import SupabaseError
from app.dependencies.supabase import get_supabase_client


def _format_delivery_fee_settings(row: dict | None) -> dict | None:
    if not row:
        return None

    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "delivery_fee_cents": int(row.get("delivery_fee_cents") or 0),
        "shipping_fee_cents": int(row.get("shipping_fee_cents") or 0),
        "effective_at": row.get("effective_at"),
    }


def _fetch_active_delivery_fee_row() -> dict | None:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "platform_delivery_fee_settings",
            query={
                "select": "id,name,delivery_fee_cents,shipping_fee_cents,effective_at,is_active",
                "is_active": "eq.true",
                "order": "effective_at.desc",
            },
            use_service_role=True,
        )
    except SupabaseError:
        return None

    return rows[0] if rows else None


def _deactivate_active_delivery_fee_rows() -> None:
    supabase = get_supabase_client()
    try:
        supabase.update(
            "platform_delivery_fee_settings",
            {"is_active": False},
            query={"is_active": "eq.true"},
            use_service_role=True,
        )
    except SupabaseError:
        pass


def get_active_delivery_fee_settings() -> dict:
    row = _fetch_active_delivery_fee_row()
    if not row:
        return {
            "id": None,
            "name": "Default delivery fees",
            "delivery_fee_cents": 0,
            "shipping_fee_cents": 0,
            "effective_at": None,
        }

    formatted = _format_delivery_fee_settings(row)
    return formatted if formatted is not None else {
        "id": None,
        "name": "Default delivery fees",
        "delivery_fee_cents": 0,
        "shipping_fee_cents": 0,
        "effective_at": None,
    }


def create_delivery_fee_settings(
    *,
    name: str,
    delivery_fee_cents: int,
    shipping_fee_cents: int,
    effective_at: datetime | None = None,
) -> dict:
    supabase = get_supabase_client()
    _deactivate_active_delivery_fee_rows()

    payload: dict[str, object] = {
        "name": name,
        "delivery_fee_cents": max(0, int(delivery_fee_cents)),
        "shipping_fee_cents": max(0, int(shipping_fee_cents)),
        "is_active": True,
    }
    if effective_at:
        payload["effective_at"] = effective_at.isoformat()

    rows = supabase.insert("platform_delivery_fee_settings", payload, use_service_role=True)
    row = rows[0] if isinstance(rows, list) and rows else rows
    formatted = _format_delivery_fee_settings(row)
    if formatted:
        return formatted

    return {
        "id": None,
        "name": name,
        "delivery_fee_cents": max(0, int(delivery_fee_cents)),
        "shipping_fee_cents": max(0, int(shipping_fee_cents)),
        "effective_at": effective_at,
    }


def get_platform_added_delivery_fee_cents(fulfillment: str) -> int:
    settings = get_active_delivery_fee_settings()
    if fulfillment == "delivery":
        return settings["delivery_fee_cents"]
    if fulfillment == "shipping":
        return settings["shipping_fee_cents"]
    return 0


def list_delivery_fee_history(days: int = 14) -> list[dict]:
    if days < 1:
        days = 1
    elif days > 90:
        days = 90

    supabase = get_supabase_client()
    since = (datetime.utcnow() - timedelta(days=days)).isoformat() + "Z"
    limit = max(200, days * 25)

    try:
        rows = supabase.select(
            "orders",
            query={
                "select": "created_at,fulfillment,delivery_fee_cents",
                "created_at": f"gte.{since}",
                "order": "created_at.desc",
                "limit": str(limit),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    buckets: dict[str, dict[str, int]] = {}
    for row in rows:
        created_at = row.get("created_at")
        date_key = created_at[:10] if isinstance(created_at, str) and len(created_at) >= 10 else None
        if not date_key:
            continue

        fee = row.get("delivery_fee_cents")
        try:
            fee_cents = int(fee or 0)
        except (TypeError, ValueError):
            fee_cents = 0

        bucket = buckets.setdefault(
            date_key,
            {"delivery_fee_cents": 0, "shipping_fee_cents": 0},
        )
        if row.get("fulfillment") == "shipping":
            bucket["shipping_fee_cents"] += fee_cents
        elif row.get("fulfillment") == "delivery":
            bucket["delivery_fee_cents"] += fee_cents

    today = datetime.utcnow().date()
    history: list[dict[str, int | str]] = []
    for delta in reversed(range(days)):
        day = today - timedelta(days=delta)
        entry = buckets.get(day.isoformat(), {"delivery_fee_cents": 0, "shipping_fee_cents": 0})
        history.append(
            {
                "date": day.isoformat(),
                "delivery_fee_cents": entry["delivery_fee_cents"],
                "shipping_fee_cents": entry["shipping_fee_cents"],
            }
        )

    return history
