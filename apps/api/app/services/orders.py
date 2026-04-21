from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.orders import (
    OrderAdminEventRead,
    OrderAdminRead,
    OrderAdminSupportUpdate,
    OrderBulkActionFailure,
    OrderCreate,
    OrderBulkStatusUpdateRequest,
    OrderBulkStatusUpdateResult,
    OrderItemRead,
    OrderRead,
    OrderStatusEventRead,
    OrderStatusUpdate,
)
from app.services.delivery_fees import get_platform_added_delivery_fee_cents
from app.services.platform_fees import (
    calculate_platform_fee,
    get_active_platform_fee_rate_value,
)
from app.services.notification_delivery_worker import process_notification_delivery_rows
from app.services.notification_deliveries import queue_order_fraud_watch_notifications
from app.services.response_ai import build_transaction_response_ai_response
from app.services.workflows import ORDER_TRANSITIONS_BY_ACTOR, validate_transition
from app.services.notifications import queue_transaction_notification_jobs

FULFILLMENT_FIELD_BY_METHOD = {
    "pickup": "pickup_enabled",
    "meetup": "meetup_enabled",
    "delivery": "delivery_enabled",
    "shipping": "shipping_enabled",
}
ORDER_SELECT = (
    "id,buyer_id,seller_id,status,fulfillment,subtotal_cents,total_cents,currency,delivery_fee_cents,platform_fee_cents,platform_fee_rate,notes,buyer_browse_context,seller_response_note,"
    "order_items(id,listing_id,quantity,unit_price_cents,total_price_cents,listings(title,type,is_local_only)),"
    "order_status_events(id,status,actor_role,note,created_at)"
)
ORDER_ADMIN_SELECT = (
    f"{ORDER_SELECT},admin_note,admin_handoff_note,admin_assignee_user_id,admin_assigned_at,admin_is_escalated,admin_escalated_at,"
    "order_admin_events(id,actor_user_id,action,note,created_at)"
)
ORDER_EXCEPTION_TRIGGER_STATUSES = {"confirmed", "preparing", "ready", "out_for_delivery"}


def _serialize_order(row: dict, *, include_admin: bool = False) -> OrderRead | OrderAdminRead:
    items = [
        OrderItemRead(
            id=item["id"],
            listing_id=item["listing_id"],
            quantity=item["quantity"],
            unit_price_cents=item["unit_price_cents"],
            total_price_cents=item["total_price_cents"],
            listing_title=(item.get("listings") or {}).get("title"),
            listing_type=(item.get("listings") or {}).get("type"),
            is_local_only=(item.get("listings") or {}).get("is_local_only"),
        )
        for item in row.get("order_items", [])
    ]
    status_history = [
        OrderStatusEventRead(
            id=event["id"],
            status=event["status"],
            actor_role=event["actor_role"],
            note=event.get("note"),
            created_at=event["created_at"],
        )
        for event in sorted(
            row.get("order_status_events", []),
            key=lambda event: event.get("created_at") or "",
            reverse=True,
        )
    ]
    base_payload = dict(
        id=row["id"],
        buyer_id=row["buyer_id"],
        seller_id=row["seller_id"],
        status=row["status"],
        fulfillment=row["fulfillment"],
        subtotal_cents=row["subtotal_cents"],
        platform_fee_cents=row.get("platform_fee_cents", 0),
        platform_fee_rate=Decimal(str(row.get("platform_fee_rate", 0))),
        total_cents=row["total_cents"],
        currency=row.get("currency") or "USD",
        notes=row.get("notes"),
        buyer_browse_context=row.get("buyer_browse_context"),
        seller_response_note=row.get("seller_response_note"),
        delivery_fee_cents=row.get("delivery_fee_cents", 0),
        items=items,
        status_history=status_history,
    )
    if include_admin:
        admin_history = [
            OrderAdminEventRead(
                id=event["id"],
                actor_user_id=event["actor_user_id"],
                action=event["action"],
                note=event.get("note"),
                created_at=event["created_at"],
            )
            for event in sorted(
                row.get("order_admin_events", []),
                key=lambda event: event.get("created_at") or "",
                reverse=True,
            )
        ]
        return OrderAdminRead(
            **base_payload,
            admin_note=row.get("admin_note"),
            admin_handoff_note=row.get("admin_handoff_note"),
            admin_assignee_user_id=row.get("admin_assignee_user_id"),
            admin_assigned_at=row.get("admin_assigned_at"),
            admin_is_escalated=bool(row.get("admin_is_escalated", False)),
            admin_escalated_at=row.get("admin_escalated_at"),
            admin_history=admin_history,
        )

    return OrderRead(**base_payload)


def _get_order_by_id(*, order_id: str, access_token: str) -> OrderRead:
    supabase = get_supabase_client()
    try:
        row = supabase.select(
            "orders",
            query={
                "select": ORDER_SELECT,
                "id": f"eq.{order_id}",
            },
            access_token=access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return _serialize_order(row)


def _get_order_row_by_id(*, order_id: str, access_token: str) -> dict:
    supabase = get_supabase_client()
    try:
        return supabase.select(
            "orders",
            query={
                "select": ORDER_SELECT,
                "id": f"eq.{order_id}",
            },
            access_token=access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _insert_order_status_event(
    *,
    order_id: str,
    status_value: str,
    actor_role: str,
    note: str | None,
    access_token: str,
) -> dict:
    supabase = get_supabase_client()
    try:
        rows = supabase.insert(
            "order_status_events",
            {
                "order_id": order_id,
                "status": status_value,
                "actor_role": actor_role,
                "note": note,
            },
            access_token=access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return rows[0]


def _get_seller_user_id(*, seller_id: str) -> str | None:
    supabase = get_supabase_client()
    try:
        seller_profile = supabase.select(
            "seller_profiles",
            query={
                "select": "user_id",
                "id": f"eq.{seller_id}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            return None
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return seller_profile.get("user_id")


def _get_seller_profile_summary(*, seller_id: str) -> dict[str, str] | None:
    supabase = get_supabase_client()
    try:
        seller_profile = _normalize_single_row(
            supabase.select(
                "seller_profiles",
                query={
                    "select": "id,slug,display_name,user_id",
                    "id": f"eq.{seller_id}",
                },
                use_service_role=True,
                expect_single=True,
            )
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            return None
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not seller_profile:
        return None

    return {
        "id": str(seller_profile.get("id") or ""),
        "slug": str(seller_profile.get("slug") or ""),
        "display_name": str(seller_profile.get("display_name") or ""),
        "user_id": str(seller_profile.get("user_id") or ""),
    }


def _get_buyer_profile_summary(*, buyer_id: str) -> dict[str, str] | None:
    supabase = get_supabase_client()
    try:
        buyer_profile = _normalize_single_row(
            supabase.select(
                "profiles",
                query={
                    "select": "id,display_name",
                    "id": f"eq.{buyer_id}",
                },
                use_service_role=True,
                expect_single=True,
            )
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            return None
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not buyer_profile:
        return None

    return {
        "id": str(buyer_profile.get("id") or ""),
        "display_name": str(buyer_profile.get("display_name") or ""),
    }


def _normalize_single_row(row: Any) -> dict[str, Any] | None:
    if isinstance(row, list):
        if not row:
            return None
        row = row[0]
    return row if isinstance(row, dict) else None


def _normalize_row_list(rows: Any) -> list[dict[str, Any]]:
    if isinstance(rows, list):
        return [row for row in rows if isinstance(row, dict)]
    if isinstance(rows, dict):
        return [rows]
    return []


def _queue_order_exception_notification(
    *,
    order: dict,
    previous_status: str,
    actor_role: str,
) -> None:
    if previous_status not in ORDER_EXCEPTION_TRIGGER_STATUSES or order.get("status") != "canceled":
        return

    seller = _get_seller_profile_summary(seller_id=order["seller_id"])
    if not seller:
        return
    buyer = _get_buyer_profile_summary(buyer_id=order["buyer_id"])
    buyer_display_name = buyer.get("display_name") if buyer else ""
    buyer_display_name = buyer_display_name.strip() if isinstance(buyer_display_name, str) else ""
    if not buyer_display_name:
        buyer_display_name = "Buyer"

    settings = get_settings()
    admin_ids = [
        admin_id
        for admin_id in settings.admin_user_ids
        if (settings.admin_user_roles or {}).get(admin_id, "").lower() in {"support", "owner"}
    ]
    if not admin_ids:
        admin_ids = list(settings.admin_user_ids)

    recipient_user_ids = []
    if seller.get("user_id"):
        recipient_user_ids.append(seller["user_id"])
    recipient_user_ids.extend(admin_ids)
    recipient_user_ids = list(dict.fromkeys(recipient_user_ids))
    if not recipient_user_ids:
        return

    notification_event_id = (
        f"order-exception:{order['id']}:{previous_status}:{order.get('status')}:{actor_role}"
    )
    supabase = get_supabase_client()
    try:
        existing_rows = supabase.select(
            "notification_deliveries",
            query={
                "select": "recipient_user_id,event_id",
                "event_id": f"eq.{notification_event_id}",
            },
            use_service_role=True,
        )
    except SupabaseError:
        existing_rows = []
    else:
        existing_rows = _normalize_row_list(existing_rows)

    existing_recipients = {
        str(row.get("recipient_user_id"))
        for row in existing_rows
        if row.get("recipient_user_id")
    }

    profile_rows = []
    try:
        profile_rows = supabase.select(
            "profiles",
            query={
                "select": "id,email_notifications_enabled,push_notifications_enabled",
                "id": f"in.({','.join(recipient_user_ids)})",
            },
            use_service_role=True,
        )
    except SupabaseError:
        profile_rows = []
    else:
        profile_rows = _normalize_row_list(profile_rows)

    profile_prefs = {
        str(row.get("id")): row
        for row in profile_rows
        if row.get("id")
    }

    listing_title = None
    if order.get("order_items"):
        first_item = order["order_items"][0] or {}
        listing_title = ((first_item.get("listings") or {}).get("title") or "").strip() or None
    listing_label = listing_title or f"order {order['id']}"
    exception_reason = (
        f"Order was canceled by {actor_role} after reaching {previous_status}. "
        "Review the seller handoff and buyer follow-up."
    )
    subject = f"Order exception for {listing_label}"
    body = exception_reason
    html = (
        f"<p>Order exception for <strong>{listing_label}</strong>.</p>"
        f"<p><strong>Previous status:</strong> {previous_status}</p>"
        f"<p><strong>Current status:</strong> canceled</p>"
        f"<p><strong>Actor:</strong> {actor_role}</p>"
        f"<p>{exception_reason}</p>"
    )

    deliveries: list[dict[str, object]] = []
    for recipient_user_id in recipient_user_ids:
        if recipient_user_id in existing_recipients:
            continue

        prefs = profile_prefs.get(recipient_user_id, {})
        payload = {
        "alert_type": "order_exception",
        "buyer_id": order["buyer_id"],
        "buyer_display_name": buyer_display_name,
        "seller_id": seller["id"],
        "seller_slug": seller["slug"],
        "seller_display_name": seller["display_name"],
            "order_id": order["id"],
            "listing_id": order.get("order_items", [{}])[0].get("listing_id"),
            "listing_title": listing_title,
            "previous_status": previous_status,
            "current_status": "canceled",
            "actor_role": actor_role,
            "exception_reason": exception_reason,
            "alert_signature": notification_event_id,
            "subject": subject,
            "body": body,
            "html": html,
        }

        if prefs.get("email_notifications_enabled", True):
            deliveries.append(
                {
                    "recipient_user_id": recipient_user_id,
                    "transaction_kind": "order",
                    "transaction_id": order["id"],
                    "event_id": notification_event_id,
                    "channel": "email",
                    "delivery_status": "queued",
                    "payload": payload,
                }
            )

        if prefs.get("push_notifications_enabled", True):
            deliveries.append(
                {
                    "recipient_user_id": recipient_user_id,
                    "transaction_kind": "order",
                    "transaction_id": order["id"],
                    "event_id": notification_event_id,
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

        try:
            queue_order_fraud_watch_notifications(
                order=order,
                previous_status=previous_status,
                actor_role=actor_role,
            )
        except Exception:
            return


def get_my_orders(current_user: CurrentUser) -> list[OrderRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "orders",
            query={
                "select": ORDER_SELECT,
                "buyer_id": f"eq.{current_user.id}",
                "order": "created_at.desc",
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [_serialize_order(row) for row in rows]


def get_order_by_id_for_user(current_user: CurrentUser, order_id: str) -> OrderRead:
    return _get_order_by_id(order_id=order_id, access_token=current_user.access_token)


def get_admin_orders() -> list[OrderAdminRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "orders",
            query={
                "select": ORDER_ADMIN_SELECT,
                "order": "created_at.desc",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [_serialize_order(row, include_admin=True) for row in rows]


def _insert_order_admin_events(
    *,
    order_id: str,
    actor_user_id: str,
    events: list[dict[str, str | None]],
) -> None:
    if not events:
        return

    supabase = get_supabase_client()
    try:
        supabase.insert(
            "order_admin_events",
            [
                {
                    "order_id": order_id,
                    "actor_user_id": actor_user_id,
                    "action": event["action"],
                    "note": event.get("note"),
                }
                for event in events
            ],
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def update_admin_order_support(
    order_id: str,
    payload: OrderAdminSupportUpdate,
    *,
    actor_user_id: str,
) -> OrderAdminRead:
    supabase = get_supabase_client()
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No admin support changes provided")

    try:
        current_row = supabase.select(
            "orders",
            query={
                "select": ORDER_ADMIN_SELECT,
                "id": f"eq.{order_id}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    admin_events: list[dict[str, str | None]] = []
    if "admin_note" in updates and updates["admin_note"] != current_row.get("admin_note"):
        admin_events.append({"action": "admin_note_updated", "note": updates["admin_note"]})
    if "admin_handoff_note" in updates and updates["admin_handoff_note"] != current_row.get("admin_handoff_note"):
        admin_events.append({"action": "handoff_note_updated", "note": updates["admin_handoff_note"]})

    if "admin_assignee_user_id" in updates:
        if updates["admin_assignee_user_id"] != current_row.get("admin_assignee_user_id"):
            admin_events.append(
                {
                    "action": "assignment_set" if updates["admin_assignee_user_id"] else "assignment_cleared",
                    "note": updates["admin_assignee_user_id"],
                }
            )
        updates["admin_assigned_at"] = (
            datetime.now(timezone.utc).isoformat() if updates["admin_assignee_user_id"] else None
        )

    if "admin_is_escalated" in updates:
        if bool(updates["admin_is_escalated"]) != bool(current_row.get("admin_is_escalated", False)):
            admin_events.append(
                {
                    "action": "escalation_enabled" if updates["admin_is_escalated"] else "escalation_cleared",
                    "note": None,
                }
            )
        updates["admin_escalated_at"] = (
            datetime.now(timezone.utc).isoformat() if updates["admin_is_escalated"] else None
        )

    try:
        rows = supabase.update(
            "orders",
            updates,
            query={
                "id": f"eq.{order_id}",
                "select": ORDER_ADMIN_SELECT,
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    _insert_order_admin_events(order_id=order_id, actor_user_id=actor_user_id, events=admin_events)
    return _serialize_order(rows[0], include_admin=True)


def get_seller_orders(current_user: CurrentUser) -> list[OrderRead]:
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
            return []
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    try:
        rows = supabase.select(
            "orders",
            query={
                "select": ORDER_SELECT,
                "seller_id": f"eq.{seller['id']}",
                "order": "created_at.desc",
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [_serialize_order(row) for row in rows]

def create_order(current_user: CurrentUser, payload: OrderCreate) -> OrderRead:
    supabase = get_supabase_client()
    listing_ids = [item.listing_id for item in payload.items]
    if not listing_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order must include at least one item")

    id_filter = ",".join(listing_ids)
    try:
        listings = supabase.select(
            "listings",
            query={
                "select": (
                    "id,seller_id,price_cents,currency,status,type,pickup_enabled,"
                    "meetup_enabled,delivery_enabled,shipping_enabled"
                ),
                "id": f"in.({id_filter})",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    listing_map = {listing["id"]: listing for listing in listings}
    subtotal = 0
    currency = "USD"
    order_items: list[dict[str, int | str]] = []
    fulfillment_field = FULFILLMENT_FIELD_BY_METHOD.get(payload.fulfillment)
    if fulfillment_field is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported fulfillment method: {payload.fulfillment}",
        )

    for item in payload.items:
        listing = listing_map.get(item.listing_id)
        if listing is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Listing not found: {item.listing_id}")
        if listing["seller_id"] != payload.seller_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="All items must belong to the seller")
        if listing["status"] != "active":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only active listings can be ordered")
        if listing.get("type") == "service":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Service listings must be booked instead of ordered",
            )
        if not listing.get(fulfillment_field):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Listing does not support {payload.fulfillment}",
            )
        unit_price = listing.get("price_cents")
        if unit_price is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order items require priced listings")
        if item.quantity < 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order quantities must be positive")

        currency = listing.get("currency") or currency
        line_total = unit_price * item.quantity
        subtotal += line_total
        order_items.append(
            {
                "listing_id": item.listing_id,
                "quantity": item.quantity,
                "unit_price_cents": unit_price,
                "total_price_cents": line_total,
            }
        )

    delivery_fee_cents = get_platform_added_delivery_fee_cents(payload.fulfillment)
    platform_fee_rate = get_active_platform_fee_rate_value()
    platform_fee_cents = calculate_platform_fee(subtotal, platform_fee_rate)
    total_cents = subtotal + delivery_fee_cents + platform_fee_cents

    try:
        rows = supabase.insert(
            "orders",
            {
                "buyer_id": current_user.id,
                "seller_id": payload.seller_id,
                "fulfillment": payload.fulfillment,
                "subtotal_cents": subtotal,
                "total_cents": total_cents,
                "currency": currency,
                "notes": payload.notes,
                "buyer_browse_context": payload.buyer_browse_context,
                "delivery_fee_cents": delivery_fee_cents,
                "platform_fee_cents": platform_fee_cents,
                "platform_fee_rate": str(platform_fee_rate),
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    order = rows[0]

    try:
        supabase.insert(
            "order_items",
            [{**item, "order_id": order["id"]} for item in order_items],
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    event = _insert_order_status_event(
        order_id=order["id"],
        status_value=order["status"],
        actor_role="buyer",
        note=payload.notes,
        access_token=current_user.access_token,
    )
    queue_transaction_notification_jobs(
        recipient_user_id=_get_seller_user_id(seller_id=payload.seller_id),
        transaction_kind="order",
        transaction_id=order["id"],
        event_id=event["id"],
        status_value=order["status"],
        actor_role="buyer",
        note=payload.notes,
    )

    return _get_order_by_id(order_id=order["id"], access_token=current_user.access_token)

def update_order_status(current_user: CurrentUser, order_id: str, payload: OrderStatusUpdate) -> OrderRead:
    supabase = get_supabase_client()
    current_order = _get_order_row_by_id(
        order_id=order_id,
        access_token=current_user.access_token,
    )

    actor = _resolve_order_actor(
        current_user=current_user,
        access_token=current_user.access_token,
        seller_id=current_order["seller_id"],
    )
    validate_transition(
        current_status=current_order["status"],
        next_status=payload.status,
        actor=actor,
        workflow_name="order",
        transitions_by_actor=ORDER_TRANSITIONS_BY_ACTOR,
    )

    try:
        rows = supabase.update(
            "orders",
            {
                "status": payload.status,
                "seller_response_note": payload.seller_response_note,
            },
            query={
                "id": f"eq.{order_id}",
                "select": ORDER_SELECT,
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    event = _insert_order_status_event(
        order_id=order_id,
        status_value=payload.status,
        actor_role=actor,
        note=payload.seller_response_note,
        access_token=current_user.access_token,
    )
    queue_transaction_notification_jobs(
        recipient_user_id=(
            current_order["buyer_id"]
            if actor == "seller"
            else _get_seller_user_id(seller_id=current_order["seller_id"])
        ),
        transaction_kind="order",
        transaction_id=order_id,
        event_id=event["id"],
        status_value=payload.status,
        actor_role=actor,
        note=payload.seller_response_note,
    )
    if payload.status == "canceled":
        _queue_order_exception_notification(
            order=current_order | {"status": payload.status},
            previous_status=current_order["status"],
            actor_role=actor,
        )

    updated_order = _normalize_single_row(rows)
    if updated_order is None:
        return _get_order_by_id(order_id=order_id, access_token=current_user.access_token)
    return _serialize_order(updated_order)


def generate_order_response_ai_assist(current_user: CurrentUser, order_id: str):
    current_order = _get_order_row_by_id(
        order_id=order_id,
        access_token=current_user.access_token,
    )
    return build_transaction_response_ai_response(
        transaction_kind="order",
        transaction_id=order_id,
        transaction_status=current_order["status"],
        buyer_notes=current_order.get("notes"),
        buyer_context=current_order.get("buyer_browse_context"),
        transaction_label=current_order.get("listing_title") or current_order.get("fulfillment"),
    )


def _validate_order_status_update(
    current_user: CurrentUser,
    order_id: str,
    payload: OrderStatusUpdate,
) -> None:
    current_order = _get_order_row_by_id(
        order_id=order_id,
        access_token=current_user.access_token,
    )
    actor = _resolve_order_actor(
        current_user=current_user,
        access_token=current_user.access_token,
        seller_id=current_order["seller_id"],
    )
    validate_transition(
        current_status=current_order["status"],
        next_status=payload.status,
        actor=actor,
        workflow_name="order",
        transitions_by_actor=ORDER_TRANSITIONS_BY_ACTOR,
    )


def bulk_update_order_statuses(
    current_user: CurrentUser,
    payload: OrderBulkStatusUpdateRequest,
) -> OrderBulkStatusUpdateResult:
    succeeded_ids: list[str] = []
    failed: list[OrderBulkActionFailure] = []
    atomic_mode = payload.execution_mode == "atomic"

    if atomic_mode:
        preflight_failures: list[OrderBulkActionFailure] = []
        for item in payload.updates:
            try:
                _validate_order_status_update(
                    current_user,
                    item.order_id,
                    OrderStatusUpdate(
                        status=item.status,
                        seller_response_note=item.seller_response_note,
                    ),
                )
            except HTTPException as exc:
                preflight_failures.append(
                    OrderBulkActionFailure(id=item.order_id, detail=str(exc.detail)),
                )

        if preflight_failures:
            return OrderBulkStatusUpdateResult(succeeded_ids=[], failed=preflight_failures)

    for item in payload.updates:
        try:
            update_order_status(
                current_user,
                item.order_id,
                OrderStatusUpdate(
                    status=item.status,
                    seller_response_note=item.seller_response_note,
                ),
            )
            succeeded_ids.append(item.order_id)
        except HTTPException as exc:
            failed.append(OrderBulkActionFailure(id=item.order_id, detail=str(exc.detail)))

    return OrderBulkStatusUpdateResult(succeeded_ids=succeeded_ids, failed=failed)


def _resolve_order_actor(*, current_user: CurrentUser, access_token: str | None, seller_id: str) -> str:
    if current_user.id:
        supabase = get_supabase_client()
        try:
            seller_profile = supabase.select(
                "seller_profiles",
                query={
                    "select": "id",
                    "id": f"eq.{seller_id}",
                    "user_id": f"eq.{current_user.id}",
                },
                access_token=access_token,
                expect_single=True,
            )
            if seller_profile["id"] == seller_id:
                return "seller"
        except SupabaseError as exc:
            if exc.status_code != 406:
                raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return "buyer"
