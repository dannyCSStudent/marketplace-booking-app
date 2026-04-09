from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.subscriptions import (
    SellerSubscriptionAssign,
    SellerSubscriptionEventRead,
    SellerSubscriptionRead,
    SubscriptionTierCreate,
    SubscriptionTierRead,
)

TIER_SELECT = (
    "id,code,name,monthly_price_cents,perks_summary,analytics_enabled,"
    "priority_visibility,premium_storefront,is_active,created_at"
)
SUBSCRIPTION_SELECT = (
    "id,seller_id,tier_id,started_at,ended_at,is_active,created_at,"
    "seller_profiles(display_name,slug),"
    "subscription_tiers(code,name,monthly_price_cents,perks_summary,analytics_enabled,priority_visibility,premium_storefront)"
)
SUBSCRIPTION_EVENT_SELECT = (
    "id,seller_id,seller_subscription_id,actor_user_id,action,reason_code,from_tier_id,to_tier_id,note,created_at,"
    "seller_profiles(display_name,slug),"
    "from_tier:subscription_tiers!seller_subscription_events_from_tier_id_fkey(code,name),"
    "to_tier:subscription_tiers!seller_subscription_events_to_tier_id_fkey(code,name)"
)


def _format_tier(row: dict | None) -> dict | None:
    if not row:
        return None

    return {
        "id": row.get("id"),
        "code": row.get("code"),
        "name": row.get("name"),
        "monthly_price_cents": int(row.get("monthly_price_cents") or 0),
        "perks_summary": row.get("perks_summary"),
        "analytics_enabled": bool(row.get("analytics_enabled") or False),
        "priority_visibility": bool(row.get("priority_visibility") or False),
        "premium_storefront": bool(row.get("premium_storefront") or False),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
    }


def _format_subscription(row: dict | None) -> dict | None:
    if not row:
        return None

    seller_row = row.get("seller_profiles") or {}
    tier_row = row.get("subscription_tiers") or {}
    return {
        "id": row.get("id"),
        "seller_id": row.get("seller_id"),
        "seller_slug": seller_row.get("slug"),
        "seller_display_name": seller_row.get("display_name"),
        "tier_id": row.get("tier_id"),
        "tier_code": tier_row.get("code"),
        "tier_name": tier_row.get("name"),
        "monthly_price_cents": int(tier_row.get("monthly_price_cents") or 0),
        "perks_summary": tier_row.get("perks_summary"),
        "analytics_enabled": bool(tier_row.get("analytics_enabled") or False),
        "priority_visibility": bool(tier_row.get("priority_visibility") or False),
        "premium_storefront": bool(tier_row.get("premium_storefront") or False),
        "started_at": row.get("started_at"),
        "ended_at": row.get("ended_at"),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
    }


def _format_subscription_event(row: dict | None, actor_profiles_by_id: dict[str, dict] | None = None) -> dict | None:
    if not row:
        return None

    seller_row = row.get("seller_profiles") or {}
    actor_profiles_by_id = actor_profiles_by_id or {}
    actor_row = actor_profiles_by_id.get(str(row.get("actor_user_id") or ""), {})
    from_tier = row.get("from_tier") or {}
    to_tier = row.get("to_tier") or {}
    return {
        "id": row.get("id"),
        "seller_id": row.get("seller_id"),
        "seller_slug": seller_row.get("slug"),
        "seller_display_name": seller_row.get("display_name"),
        "seller_subscription_id": row.get("seller_subscription_id"),
        "actor_user_id": row.get("actor_user_id"),
        "actor_name": actor_row.get("full_name") or actor_row.get("username"),
        "action": row.get("action"),
        "reason_code": row.get("reason_code"),
        "from_tier_id": row.get("from_tier_id"),
        "from_tier_code": from_tier.get("code"),
        "from_tier_name": from_tier.get("name"),
        "to_tier_id": row.get("to_tier_id"),
        "to_tier_code": to_tier.get("code"),
        "to_tier_name": to_tier.get("name"),
        "note": row.get("note"),
        "created_at": row.get("created_at"),
    }


def _list_actor_profiles(actor_user_ids: list[str]) -> dict[str, dict]:
    if not actor_user_ids:
        return {}

    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "profiles",
            query={
                "select": "id,full_name,username",
                "id": f"in.({','.join(actor_user_ids)})",
            },
            use_service_role=True,
        )
    except SupabaseError:
        return {}

    return {str(row.get("id")): row for row in rows if row.get("id")}


def list_subscription_tiers() -> list[SubscriptionTierRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "subscription_tiers",
            query={"select": TIER_SELECT, "order": "monthly_price_cents.asc,created_at.asc"},
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [SubscriptionTierRead(**formatted) for row in rows if (formatted := _format_tier(row))]


def create_subscription_tier(payload: SubscriptionTierCreate) -> SubscriptionTierRead:
    supabase = get_supabase_client()
    try:
        rows = supabase.insert(
            "subscription_tiers",
            payload.model_dump(),
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    formatted = _format_tier(rows[0] if isinstance(rows, list) and rows else rows)
    if not formatted:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to create subscription tier")
    return SubscriptionTierRead(**formatted)


def list_seller_subscriptions(limit: int = 24) -> list[SellerSubscriptionRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "seller_subscriptions",
            query={"select": SUBSCRIPTION_SELECT, "order": "started_at.desc", "limit": str(limit)},
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [SellerSubscriptionRead(**formatted) for row in rows if (formatted := _format_subscription(row))]


def list_subscription_events(limit: int = 24) -> list[SellerSubscriptionEventRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "seller_subscription_events",
            query={"select": SUBSCRIPTION_EVENT_SELECT, "order": "created_at.desc", "limit": str(limit)},
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    actor_user_ids = sorted({str(row.get("actor_user_id")) for row in rows if row.get("actor_user_id")})
    actor_profiles_by_id = _list_actor_profiles(actor_user_ids)
    return [
        SellerSubscriptionEventRead(**formatted)
        for row in rows
        if (formatted := _format_subscription_event(row, actor_profiles_by_id))
    ]


def _get_seller_by_slug(slug: str) -> dict:
    supabase = get_supabase_client()
    try:
        return supabase.select(
            "seller_profiles",
            query={"select": "id,display_name,slug", "slug": f"eq.{slug}"},
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seller profile not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def get_seller_subscription_by_slug(slug: str) -> SellerSubscriptionRead:
    seller = _get_seller_by_slug(slug)
    return get_active_seller_subscription(seller["id"])


def _get_tier_by_id(tier_id: str) -> dict:
    supabase = get_supabase_client()
    try:
        return supabase.select(
            "subscription_tiers",
            query={"select": TIER_SELECT, "id": f"eq.{tier_id}"},
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscription tier not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _deactivate_existing_subscription(seller_id: str) -> None:
    supabase = get_supabase_client()
    try:
        supabase.update(
            "seller_subscriptions",
            {"is_active": False, "ended_at": datetime.now(timezone.utc).isoformat()},
            query={"seller_id": f"eq.{seller_id}", "is_active": "eq.true"},
            use_service_role=True,
        )
    except SupabaseError:
        pass


def _get_existing_active_subscription_row(seller_id: str) -> dict | None:
    supabase = get_supabase_client()
    try:
        return supabase.select(
            "seller_subscriptions",
            query={
                "select": SUBSCRIPTION_SELECT,
                "seller_id": f"eq.{seller_id}",
                "is_active": "eq.true",
                "order": "started_at.desc",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            return None
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _resolve_subscription_event_action(previous_subscription: dict | None, next_tier: dict) -> str:
    if not previous_subscription:
        return "started"

    previous_tier = previous_subscription.get("subscription_tiers") or {}
    previous_price = int(previous_tier.get("monthly_price_cents") or 0)
    next_price = int(next_tier.get("monthly_price_cents") or 0)
    previous_ended_at = previous_subscription.get("ended_at")
    previous_started_at = previous_subscription.get("started_at")
    if previous_ended_at and previous_started_at:
        ended_time = datetime.fromisoformat(str(previous_ended_at).replace("Z", "+00:00"))
        started_time = datetime.fromisoformat(str(previous_started_at).replace("Z", "+00:00"))
        if (ended_time - started_time).total_seconds() > 0:
            pass

    if next_price > previous_price:
        return "upgrade"
    if next_price < previous_price:
        return "downgrade"
    return "lateral"


def _record_subscription_event(
    *,
    seller_id: str,
    seller_subscription_id: str | None,
    actor_user_id: str,
    action: str,
    reason_code: str | None,
    from_tier_id: str | None,
    to_tier_id: str | None,
    note: str | None = None,
) -> None:
    supabase = get_supabase_client()
    payload = {
        "seller_id": seller_id,
        "seller_subscription_id": seller_subscription_id,
        "actor_user_id": actor_user_id,
        "action": action,
        "reason_code": reason_code,
        "from_tier_id": from_tier_id,
        "to_tier_id": to_tier_id,
        "note": note,
    }
    try:
        supabase.insert("seller_subscription_events", payload, use_service_role=True)
    except (SupabaseError, AttributeError):
        pass


def get_active_seller_subscription(seller_id: str) -> SellerSubscriptionRead:
    supabase = get_supabase_client()
    try:
        row = supabase.select(
            "seller_subscriptions",
            query={
                "select": SUBSCRIPTION_SELECT,
                "seller_id": f"eq.{seller_id}",
                "is_active": "eq.true",
                "order": "started_at.desc",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seller subscription not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    formatted = _format_subscription(row)
    if not formatted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seller subscription not found")
    return SellerSubscriptionRead(**formatted)


def get_my_seller_subscription(current_user: CurrentUser) -> SellerSubscriptionRead:
    supabase = get_supabase_client()
    try:
        seller = supabase.select(
            "seller_profiles",
            query={"select": "id", "user_id": f"eq.{current_user.id}"},
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seller profile not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return get_active_seller_subscription(seller["id"])


def assign_seller_subscription(payload: SellerSubscriptionAssign, *, actor_user_id: str | None = None) -> SellerSubscriptionRead:
    seller = _get_seller_by_slug(payload.seller_slug)
    next_tier = _get_tier_by_id(payload.tier_id)
    previous_subscription = _get_existing_active_subscription_row(seller["id"])
    _deactivate_existing_subscription(seller["id"])

    supabase = get_supabase_client()
    try:
        rows = supabase.insert(
            "seller_subscriptions",
            {"seller_id": seller["id"], "tier_id": payload.tier_id, "is_active": True},
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    row = rows[0] if isinstance(rows, list) and rows else rows
    if not row:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to assign subscription")

    try:
        hydrated = supabase.select(
            "seller_subscriptions",
            query={"select": SUBSCRIPTION_SELECT, "id": f"eq.{row.get('id')}"},
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    formatted = _format_subscription(hydrated)
    if not formatted:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to load assigned subscription")
    subscription = SellerSubscriptionRead(**formatted)

    if actor_user_id:
        previous_tier_id = previous_subscription.get("tier_id") if previous_subscription else None
        action = _resolve_subscription_event_action(previous_subscription, next_tier)
        _record_subscription_event(
            seller_id=seller["id"],
            seller_subscription_id=subscription.id,
            actor_user_id=actor_user_id,
            action=action,
            reason_code=payload.reason_code,
            from_tier_id=previous_tier_id,
            to_tier_id=payload.tier_id,
            note=payload.note,
        )

    return subscription
