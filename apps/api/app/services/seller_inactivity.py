from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.supabase import SupabaseError
from app.dependencies.supabase import get_supabase_client
from app.schemas.seller_inactivity import SellerInactivityEventRead, SellerInactivitySummaryRead
from app.services.notification_delivery_worker import process_notification_delivery_rows

INACTIVITY_ALERT_THRESHOLD_DAYS = 14
INACTIVITY_WARNING_THRESHOLD_DAYS = 21
INACTIVITY_HIGH_THRESHOLD_DAYS = 30
INACTIVITY_CRITICAL_THRESHOLD_DAYS = 60
SELLER_INACTIVITY_ALERT_SELECT = (
    "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
    "delivery_status,payload,created_at"
)


def _parse_timestamp(value: object) -> datetime | None:
    if type(value).__name__ == "datetime":
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _latest_timestamp(values: list[datetime | None]) -> datetime | None:
    valid_values = [value for value in values if value is not None]
    if not valid_values:
        return None
    return max(valid_values)


def _is_datetime(value: object) -> bool:
    return type(value).__name__ == "datetime"


def _severity_for_idle_days(idle_days: int) -> tuple[str, str]:
    if idle_days >= INACTIVITY_CRITICAL_THRESHOLD_DAYS:
        return "high", "rose"
    if idle_days >= INACTIVITY_HIGH_THRESHOLD_DAYS:
        return "high", "rose"
    if idle_days >= INACTIVITY_WARNING_THRESHOLD_DAYS:
        return "medium", "amber"
    return "monitor", "sky"


def _last_active_kind_label(kind: str) -> str:
    labels = {
        "listing_updated": "listing update",
        "order_created": "order created",
        "booking_created": "booking created",
        "seller_profile_updated": "seller profile update",
    }
    return labels.get(kind, kind.replace("_", " "))


def _seller_inactivity_signature(seller_id: str, idle_days: int, last_active_kind: str) -> str:
    bucket = max(1, idle_days // 7)
    return f"seller-inactivity:{seller_id}:{last_active_kind}:{bucket}"


def _seller_inactivity_payload(
    *,
    seller_id: str,
    seller_slug: str,
    seller_display_name: str,
    last_active_at: datetime | None,
    last_active_kind: str,
    idle_days: int,
    severity: str,
    tone: str,
    alert_signature: str,
) -> dict[str, object]:
    last_active_label = _last_active_kind_label(last_active_kind)
    alert_reason = (
        f"{seller_display_name} has been idle for {idle_days} day{'' if idle_days == 1 else 's'}."
        if idle_days > 0
        else f"{seller_display_name} has no recent activity."
    )
    subject = f"Seller inactivity alert for {seller_display_name}"
    body = (
        f"{seller_display_name} has not had recent marketplace activity. "
        f"Last activity: {last_active_label}."
    )
    html = (
        f"<p>Seller inactivity alert for <strong>{seller_display_name}</strong>.</p>"
        f"<p><strong>Idle days:</strong> {idle_days}</p>"
        f"<p><strong>Last active:</strong> {last_active_label}</p>"
    )
    return {
        "alert_type": "seller_inactivity",
        "seller_id": seller_id,
        "seller_slug": seller_slug,
        "seller_display_name": seller_display_name,
        "last_active_at": last_active_at.isoformat() if last_active_at else None,
        "last_active_kind": last_active_kind,
        "idle_days": idle_days,
        "severity": severity,
        "tone": tone,
        "action_label": "Review seller activity",
        "alert_reason": alert_reason,
        "alert_signature": alert_signature,
        "subject": subject,
        "body": body,
        "html": html,
    }


def _build_seller_activity_index() -> list[dict[str, object]]:
    supabase = get_supabase_client()
    try:
        seller_rows = supabase.select(
            "seller_profiles",
            query={
                "select": "id,user_id,display_name,slug,updated_at",
                "order": "updated_at.desc",
                "limit": "200",
            },
            use_service_role=True,
        )
        listing_rows = supabase.select(
            "listings",
            query={
                "select": "seller_id,updated_at,created_at",
                "order": "updated_at.desc",
                "limit": "500",
            },
            use_service_role=True,
        )
        order_rows = supabase.select(
            "orders",
            query={
                "select": "seller_id,created_at",
                "order": "created_at.desc",
                "limit": "500",
            },
            use_service_role=True,
        )
        booking_rows = supabase.select(
            "bookings",
            query={
                "select": "seller_id,created_at",
                "order": "created_at.desc",
                "limit": "500",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    seller_by_id = {row["id"]: row for row in seller_rows if row.get("id")}
    latest_activity: dict[str, dict[str, object]] = {}

    for seller_id, row in seller_by_id.items():
        updated_at = _parse_timestamp(row.get("updated_at"))
        if updated_at is not None:
            latest_activity[seller_id] = {
                "last_active_at": updated_at,
                "last_active_kind": "seller_profile_updated",
            }

    for row in listing_rows:
        seller_id = str(row.get("seller_id") or "").strip()
        if not seller_id:
            continue
        timestamp = _parse_timestamp(row.get("updated_at") or row.get("created_at"))
        if timestamp is None:
            continue
        current = latest_activity.get(seller_id)
        if current is None or timestamp > current["last_active_at"]:
            latest_activity[seller_id] = {
                "last_active_at": timestamp,
                "last_active_kind": "listing_updated",
            }

    for row in order_rows:
        seller_id = str(row.get("seller_id") or "").strip()
        if not seller_id:
            continue
        timestamp = _parse_timestamp(row.get("created_at"))
        if timestamp is None:
            continue
        current = latest_activity.get(seller_id)
        if current is None or timestamp > current["last_active_at"]:
            latest_activity[seller_id] = {
                "last_active_at": timestamp,
                "last_active_kind": "order_created",
            }

    for row in booking_rows:
        seller_id = str(row.get("seller_id") or "").strip()
        if not seller_id:
            continue
        timestamp = _parse_timestamp(row.get("created_at"))
        if timestamp is None:
            continue
        current = latest_activity.get(seller_id)
        if current is None or timestamp > current["last_active_at"]:
            latest_activity[seller_id] = {
                "last_active_at": timestamp,
                "last_active_kind": "booking_created",
            }

    now = datetime.now(timezone.utc)
    activity_rows: list[dict[str, object]] = []
    for seller_id, seller_row in seller_by_id.items():
        activity = latest_activity.get(seller_id, {})
        last_active_at = activity.get("last_active_at")
        if not _is_datetime(last_active_at):
            last_active_at = _parse_timestamp(seller_row.get("updated_at"))
        if last_active_at is None:
            continue
        idle_days = max(0, (now - last_active_at).days)
        if idle_days < INACTIVITY_ALERT_THRESHOLD_DAYS:
            continue
        last_active_kind = str(activity.get("last_active_kind") or "seller_profile_updated")
        severity, tone = _severity_for_idle_days(idle_days)
        alert_signature = _seller_inactivity_signature(seller_id, idle_days, last_active_kind)
        activity_rows.append(
            {
                "seller_id": seller_id,
                "seller_slug": str(seller_row.get("slug") or seller_id),
                "seller_display_name": str(seller_row.get("display_name") or seller_id),
                "seller_user_id": str(seller_row.get("user_id") or "").strip(),
                "last_active_at": last_active_at,
                "last_active_kind": last_active_kind,
                "idle_days": idle_days,
                "severity": severity,
                "tone": tone,
                "alert_signature": alert_signature,
            }
        )

    activity_rows.sort(key=lambda row: (-int(row["idle_days"]), str(row["seller_id"])))
    return activity_rows


def sync_seller_inactivity_alerts() -> None:
    activity_rows = _build_seller_activity_index()
    if not activity_rows:
        return

    settings = get_settings()
    admin_ids = [
        admin_id
        for admin_id in settings.admin_user_ids
        if (settings.admin_user_roles or {}).get(admin_id, "").lower() in {"support", "owner"}
    ]
    if not admin_ids:
        admin_ids = list(settings.admin_user_ids)
    if not admin_ids:
        return

    supabase = get_supabase_client()
    try:
        profile_rows = supabase.select(
            "profiles",
            query={
                "select": "id,email_notifications_enabled,push_notifications_enabled",
                "id": f"in.({','.join(admin_ids)})",
            },
            use_service_role=True,
        )
        recent_rows = supabase.select(
            "notification_deliveries",
            query={
                "select": "recipient_user_id,event_id",
                "recipient_user_id": f"in.({','.join(admin_ids)})",
                "order": "created_at.desc",
                "limit": "200",
            },
            use_service_role=True,
        )
    except SupabaseError:
        return

    profile_prefs = {row.get("id"): row for row in profile_rows if row.get("id")}
    existing_events = {
        (row.get("recipient_user_id"), row.get("event_id"))
        for row in recent_rows
        if row.get("recipient_user_id") and row.get("event_id")
    }

    deliveries: list[dict[str, object]] = []
    for activity in activity_rows:
        seller_user_id = activity["seller_user_id"]
        seller_id = activity["seller_id"]
        seller_slug = activity["seller_slug"]
        seller_display_name = activity["seller_display_name"]
        last_active_at = activity["last_active_at"]
        last_active_kind = activity["last_active_kind"]
        idle_days = int(activity["idle_days"])
        severity = str(activity["severity"])
        tone = str(activity["tone"])
        alert_signature = str(activity["alert_signature"])
        event_id = f"{alert_signature}:{severity}"
        payload = _seller_inactivity_payload(
            seller_id=str(seller_id),
            seller_slug=str(seller_slug),
            seller_display_name=str(seller_display_name),
            last_active_at=last_active_at if _is_datetime(last_active_at) else None,
            last_active_kind=str(last_active_kind),
            idle_days=idle_days,
            severity=severity,
            tone=tone,
            alert_signature=alert_signature,
        )

        recipient_ids = [seller_user_id] if seller_user_id else []
        recipient_ids.extend(admin_ids)
        for recipient_id in recipient_ids:
            if not recipient_id or (recipient_id, event_id) in existing_events:
                continue

            prefs = profile_prefs.get(recipient_id, {})
            if prefs.get("email_notifications_enabled", True):
                deliveries.append(
                    {
                        "recipient_user_id": recipient_id,
                        "transaction_kind": "seller",
                        "transaction_id": str(seller_id),
                        "event_id": event_id,
                        "channel": "email",
                        "delivery_status": "queued",
                        "payload": payload,
                    }
                )
            if prefs.get("push_notifications_enabled", True):
                deliveries.append(
                    {
                        "recipient_user_id": recipient_id,
                        "transaction_kind": "seller",
                        "transaction_id": str(seller_id),
                        "event_id": event_id,
                        "channel": "push",
                        "delivery_status": "queued",
                        "payload": payload,
                    }
                )

    if not deliveries:
        return

    try:
        inserted_rows = supabase.insert("notification_deliveries", deliveries, use_service_role=True)
    except SupabaseError:
        return

    if inserted_rows:
        try:
            process_notification_delivery_rows(inserted_rows)
        except Exception:
            return


def list_seller_inactivity_summaries(
    *,
    limit: int = 8,
    state: str | None = None,
) -> list[SellerInactivitySummaryRead]:
    sync_seller_inactivity_alerts()

    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                    "delivery_status,payload,created_at"
                ),
                "payload->>alert_type": "eq.seller_inactivity",
                "order": "created_at.desc",
                "limit": "200",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    grouped: dict[str, dict[str, object]] = {}
    effective_state = state or "active"
    for row in rows:
        payload = row.get("payload") or {}
        seller_id = str(payload.get("seller_id") or "").strip()
        created_at = _parse_timestamp(row.get("created_at"))
        if not seller_id or created_at is None:
            continue

        alert_signature = str(payload.get("alert_signature") or "").strip()
        acknowledged_signature = str(payload.get("acknowledged_signature") or "").strip()
        is_acknowledged = bool(acknowledged_signature) and acknowledged_signature == alert_signature
        current = grouped.get(seller_id)
        if current is None:
            grouped[seller_id] = {
                "seller_id": seller_id,
                "seller_slug": str(payload.get("seller_slug") or "").strip(),
                "seller_display_name": str(payload.get("seller_display_name") or "").strip(),
                "severity": str(payload.get("severity") or "monitor"),
                "tone": str(payload.get("tone") or "sky"),
                "action_label": str(payload.get("action_label") or "Review seller activity"),
                "alert_reason": str(payload.get("alert_reason") or "Review seller inactivity"),
                "last_active_at": _parse_timestamp(payload.get("last_active_at")),
                "last_active_kind": str(payload.get("last_active_kind") or "seller profile update"),
                "idle_days": int(payload.get("idle_days") or 0),
                "alert_delivery_count": 1,
                "latest_alert_delivery_status": str(row.get("delivery_status") or "unknown"),
                "latest_alert_delivery_created_at": created_at,
                "acknowledged": is_acknowledged,
            }
            continue

        current["alert_delivery_count"] = int(current.get("alert_delivery_count", 0)) + 1
        current_created_at = current.get("latest_alert_delivery_created_at")
        if _is_datetime(current_created_at) and created_at > current_created_at:
            current["seller_slug"] = str(payload.get("seller_slug") or "").strip()
            current["seller_display_name"] = str(payload.get("seller_display_name") or "").strip()
            current["severity"] = str(payload.get("severity") or "monitor")
            current["tone"] = str(payload.get("tone") or "sky")
            current["action_label"] = str(payload.get("action_label") or "Review seller activity")
            current["alert_reason"] = str(payload.get("alert_reason") or "Review seller inactivity")
            current["last_active_at"] = _parse_timestamp(payload.get("last_active_at"))
            current["last_active_kind"] = str(payload.get("last_active_kind") or "seller profile update")
            current["idle_days"] = int(payload.get("idle_days") or 0)
            current["latest_alert_delivery_status"] = str(row.get("delivery_status") or "unknown")
            current["latest_alert_delivery_created_at"] = created_at
            current["acknowledged"] = is_acknowledged

    summaries = [SellerInactivitySummaryRead(**summary) for summary in grouped.values()]
    if effective_state == "active":
        summaries = [summary for summary in summaries if not summary.acknowledged]
    elif effective_state == "acknowledged":
        summaries = [summary for summary in summaries if summary.acknowledged]

    summaries.sort(
        key=lambda summary: (
            -summary.idle_days,
            -summary.latest_alert_delivery_created_at.timestamp(),
            summary.seller_id,
        )
    )
    return summaries[: max(1, min(limit, 20))]


def list_seller_inactivity_events(limit: int = 20) -> list[SellerInactivityEventRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "seller_inactivity_events",
            query={
                "select": (
                    "id,seller_id,seller_slug,seller_display_name,delivery_id,actor_user_id,action,"
                    "alert_signature,last_active_at,last_active_kind,idle_days,created_at"
                ),
                "order": "created_at.desc",
                "limit": str(max(1, min(limit, 100))),
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [SellerInactivityEventRead(**row) for row in rows]


def _update_seller_inactivity_acknowledgement(
    *,
    seller_id: str,
    actor_user_id: str | None,
    acknowledged: bool,
) -> list[dict]:
    supabase = get_supabase_client()
    now = datetime.now(timezone.utc).isoformat()

    try:
        rows = supabase.select(
            "notification_deliveries",
            query={
                "select": (
                    "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                    "delivery_status,payload,created_at"
                ),
                "payload->>alert_type": "eq.seller_inactivity",
                "payload->>seller_id": f"eq.{seller_id}",
                "order": "created_at.desc",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    updated_rows: list[dict] = []
    for row in rows:
        payload = dict(row.get("payload") or {})
        if acknowledged:
            payload["acknowledged_at"] = now
            if actor_user_id:
                payload["acknowledged_by_user_id"] = actor_user_id
            payload["acknowledged_signature"] = payload.get("alert_signature") or payload.get("acknowledged_signature")
        else:
            payload.pop("acknowledged_at", None)
            payload.pop("acknowledged_by_user_id", None)
            payload.pop("acknowledged_signature", None)

        try:
            updated = supabase.update(
                "notification_deliveries",
                {"payload": payload},
                query={
                    "id": f"eq.{row['id']}",
                    "select": (
                        "id,recipient_user_id,transaction_kind,transaction_id,event_id,channel,"
                        "delivery_status,payload,created_at"
                    ),
                },
                use_service_role=True,
            )
        except SupabaseError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        if updated:
            updated_rows.extend(updated)

    if updated_rows and actor_user_id:
        _insert_seller_inactivity_events(
            rows=updated_rows,
            action="acknowledged" if acknowledged else "cleared",
            actor_user_id=actor_user_id,
        )

    return updated_rows


def acknowledge_seller_inactivity_alert(seller_id: str, *, actor_user_id: str | None = None) -> list[dict]:
    return _update_seller_inactivity_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=True,
    )


def clear_seller_inactivity_acknowledgement(seller_id: str, *, actor_user_id: str | None = None) -> list[dict]:
    return _update_seller_inactivity_acknowledgement(
        seller_id=seller_id,
        actor_user_id=actor_user_id,
        acknowledged=False,
    )


def _insert_seller_inactivity_events(*, rows: list[dict], action: str, actor_user_id: str) -> None:
    supabase = get_supabase_client()
    events: list[dict[str, object]] = []

    for row in rows:
        payload = row.get("payload") or {}
        seller_id = str(payload.get("seller_id") or "").strip()
        seller_slug = str(payload.get("seller_slug") or "").strip()
        seller_display_name = str(payload.get("seller_display_name") or "").strip()
        alert_signature = str(payload.get("acknowledged_signature") or payload.get("alert_signature") or "").strip()
        if not seller_id or not seller_slug or not seller_display_name or not alert_signature:
            continue

        events.append(
            {
                "seller_id": seller_id,
                "seller_slug": seller_slug,
                "seller_display_name": seller_display_name,
                "delivery_id": row.get("id"),
                "actor_user_id": actor_user_id,
                "action": action,
                "alert_signature": alert_signature,
                "last_active_at": payload.get("last_active_at"),
                "last_active_kind": str(payload.get("last_active_kind") or "seller profile update"),
                "idle_days": int(payload.get("idle_days") or 0),
            }
        )

    if not events:
        return

    try:
        supabase.insert("seller_inactivity_events", events, use_service_role=True)
    except SupabaseError:
        return
