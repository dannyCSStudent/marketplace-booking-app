from datetime import datetime, timezone

from fastapi import HTTPException, status

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
from app.services.workflows import ORDER_TRANSITIONS_BY_ACTOR, validate_transition
from app.services.notifications import queue_transaction_notification_jobs

FULFILLMENT_FIELD_BY_METHOD = {
    "pickup": "pickup_enabled",
    "meetup": "meetup_enabled",
    "delivery": "delivery_enabled",
    "shipping": "shipping_enabled",
}
ORDER_SELECT = (
    "id,buyer_id,seller_id,status,fulfillment,subtotal_cents,total_cents,currency,notes,buyer_browse_context,seller_response_note,"
    "order_items(id,listing_id,quantity,unit_price_cents,total_price_cents,listings(title)),"
    "order_status_events(id,status,actor_role,note,created_at)"
)
ORDER_ADMIN_SELECT = (
    f"{ORDER_SELECT},admin_note,admin_handoff_note,admin_assignee_user_id,admin_assigned_at,admin_is_escalated,admin_escalated_at,"
    "order_admin_events(id,actor_user_id,action,note,created_at)"
)


def _serialize_order(row: dict, *, include_admin: bool = False) -> OrderRead | OrderAdminRead:
    items = [
        OrderItemRead(
            id=item["id"],
            listing_id=item["listing_id"],
            quantity=item["quantity"],
            unit_price_cents=item["unit_price_cents"],
            total_price_cents=item["total_price_cents"],
            listing_title=(item.get("listings") or {}).get("title"),
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
        total_cents=row["total_cents"],
        currency=row.get("currency") or "USD",
        notes=row.get("notes"),
        buyer_browse_context=row.get("buyer_browse_context"),
        seller_response_note=row.get("seller_response_note"),
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

    try:
        rows = supabase.insert(
            "orders",
            {
                "buyer_id": current_user.id,
                "seller_id": payload.seller_id,
                "fulfillment": payload.fulfillment,
                "subtotal_cents": subtotal,
                "total_cents": subtotal,
                "currency": currency,
                "notes": payload.notes,
                "buyer_browse_context": payload.buyer_browse_context,
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

    return _get_order_by_id(order_id=order_id, access_token=current_user.access_token)


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
