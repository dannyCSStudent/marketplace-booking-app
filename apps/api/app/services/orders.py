from fastapi import HTTPException, status

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.orders import (
    OrderCreate,
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
    "id,buyer_id,seller_id,status,fulfillment,subtotal_cents,total_cents,currency,notes,seller_response_note,"
    "order_items(id,listing_id,quantity,unit_price_cents,total_price_cents,listings(title)),"
    "order_status_events(id,status,actor_role,note,created_at)"
)


def _serialize_order(row: dict) -> OrderRead:
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
    return OrderRead(
        id=row["id"],
        buyer_id=row["buyer_id"],
        seller_id=row["seller_id"],
        status=row["status"],
        fulfillment=row["fulfillment"],
        subtotal_cents=row["subtotal_cents"],
        total_cents=row["total_cents"],
        currency=row.get("currency") or "USD",
        notes=row.get("notes"),
        seller_response_note=row.get("seller_response_note"),
        items=items,
        status_history=status_history,
    )


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

    try:
        current_order = supabase.select(
            "orders",
            query={
                "select": ORDER_SELECT,
                "id": f"eq.{order_id}",
            },
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

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
