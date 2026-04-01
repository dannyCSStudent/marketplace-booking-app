from datetime import timezone

from fastapi import HTTPException, status

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.bookings import (
    BookingCreate,
    BookingRead,
    BookingStatusEventRead,
    BookingStatusUpdate,
)
from app.services.workflows import BOOKING_TRANSITIONS_BY_ACTOR, validate_transition
from app.services.notifications import queue_transaction_notification_jobs

BOOKING_SELECT = (
    "id,buyer_id,seller_id,listing_id,status,scheduled_start,scheduled_end,total_cents,currency,"
    "seller_response_note,"
    "notes,listings(title,type),booking_status_events(id,status,actor_role,note,created_at)"
)


def _serialize_booking(row: dict) -> BookingRead:
    listing = row.get("listings") or {}
    status_history = [
        BookingStatusEventRead(
            id=event["id"],
            status=event["status"],
            actor_role=event["actor_role"],
            note=event.get("note"),
            created_at=event["created_at"],
        )
        for event in sorted(
            row.get("booking_status_events", []),
            key=lambda event: event.get("created_at") or "",
            reverse=True,
        )
    ]
    return BookingRead(
        id=row["id"],
        buyer_id=row["buyer_id"],
        seller_id=row["seller_id"],
        listing_id=row["listing_id"],
        status=row["status"],
        scheduled_start=row["scheduled_start"],
        scheduled_end=row["scheduled_end"],
        total_cents=row.get("total_cents"),
        currency=row.get("currency") or "USD",
        notes=row.get("notes"),
        seller_response_note=row.get("seller_response_note"),
        listing_title=listing.get("title"),
        listing_type=listing.get("type"),
        status_history=status_history,
    )


def _get_booking_by_id(*, booking_id: str, access_token: str) -> BookingRead:
    supabase = get_supabase_client()
    try:
        row = supabase.select(
            "bookings",
            query={
                "select": BOOKING_SELECT,
                "id": f"eq.{booking_id}",
            },
            access_token=access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return _serialize_booking(row)


def _insert_booking_status_event(
    *,
    booking_id: str,
    status_value: str,
    actor_role: str,
    note: str | None,
    access_token: str,
) -> dict:
    supabase = get_supabase_client()
    try:
        rows = supabase.insert(
            "booking_status_events",
            {
                "booking_id": booking_id,
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

def get_my_bookings(current_user: CurrentUser) -> list[BookingRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "bookings",
            query={
                "select": BOOKING_SELECT,
                "buyer_id": f"eq.{current_user.id}",
                "order": "created_at.desc",
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [_serialize_booking(row) for row in rows]

def get_seller_bookings(current_user: CurrentUser) -> list[BookingRead]:
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
            "bookings",
            query={
                "select": BOOKING_SELECT,
                "seller_id": f"eq.{seller['id']}",
                "order": "created_at.desc",
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [_serialize_booking(row) for row in rows]

def create_booking(current_user: CurrentUser, payload: BookingCreate) -> BookingRead:
    supabase = get_supabase_client()

    if payload.scheduled_end <= payload.scheduled_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="scheduled_end must be after scheduled_start")

    try:
        listing = supabase.select(
            "listings",
            query={
                "select": (
                    "id,seller_id,price_cents,currency,status,type,requires_booking,"
                    "duration_minutes,lead_time_hours"
                ),
                "id": f"eq.{payload.listing_id}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if listing["seller_id"] != payload.seller_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Listing does not belong to seller")
    if listing["status"] != "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only active listings can be booked")
    if listing["type"] == "product" and not listing["requires_booking"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This listing does not accept bookings")

    scheduled_start = payload.scheduled_start
    if scheduled_start.tzinfo is None:
        scheduled_start = scheduled_start.replace(tzinfo=timezone.utc)
    scheduled_end = payload.scheduled_end
    if scheduled_end.tzinfo is None:
        scheduled_end = scheduled_end.replace(tzinfo=timezone.utc)

    lead_time_hours = listing.get("lead_time_hours")
    if lead_time_hours is not None:
        earliest_start = payload.scheduled_start.now(timezone.utc).astimezone(timezone.utc)
        earliest_start = earliest_start.replace(microsecond=0)
        required_start = earliest_start.timestamp() + (lead_time_hours * 60 * 60)
        if scheduled_start.timestamp() < required_start:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Booking must respect the seller lead time of {lead_time_hours} hours",
            )

    duration_minutes = listing.get("duration_minutes")
    if duration_minutes is not None:
        scheduled_duration_minutes = int((scheduled_end - scheduled_start).total_seconds() / 60)
        if scheduled_duration_minutes != duration_minutes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Booking duration must be exactly {duration_minutes} minutes",
            )

    try:
        rows = supabase.insert(
            "bookings",
            {
                "buyer_id": current_user.id,
                "seller_id": payload.seller_id,
                "listing_id": payload.listing_id,
                "scheduled_start": scheduled_start.isoformat(),
                "scheduled_end": scheduled_end.isoformat(),
                "total_cents": listing.get("price_cents"),
                "currency": listing.get("currency") or "USD",
                "notes": payload.notes,
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    booking = rows[0]
    event = _insert_booking_status_event(
        booking_id=booking["id"],
        status_value=booking["status"],
        actor_role="buyer",
        note=payload.notes,
        access_token=current_user.access_token,
    )
    queue_transaction_notification_jobs(
        recipient_user_id=_get_seller_user_id(seller_id=payload.seller_id),
        transaction_kind="booking",
        transaction_id=booking["id"],
        event_id=event["id"],
        status_value=booking["status"],
        actor_role="buyer",
        note=payload.notes,
    )

    return _get_booking_by_id(booking_id=booking["id"], access_token=current_user.access_token)

def update_booking_status(current_user: CurrentUser, booking_id: str, payload: BookingStatusUpdate) -> BookingRead:
    supabase = get_supabase_client()

    try:
        current_booking = supabase.select(
            "bookings",
            query={
                "select": BOOKING_SELECT,
                "id": f"eq.{booking_id}",
            },
            access_token=current_user.access_token,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    actor = _resolve_booking_actor(
        current_user=current_user,
        access_token=current_user.access_token,
        seller_id=current_booking["seller_id"],
    )
    validate_transition(
        current_status=current_booking["status"],
        next_status=payload.status,
        actor=actor,
        workflow_name="booking",
        transitions_by_actor=BOOKING_TRANSITIONS_BY_ACTOR,
    )

    try:
        rows = supabase.update(
            "bookings",
            {
                "status": payload.status,
                "seller_response_note": payload.seller_response_note,
            },
            query={
                "id": f"eq.{booking_id}",
                "select": BOOKING_SELECT,
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")

    event = _insert_booking_status_event(
        booking_id=booking_id,
        status_value=payload.status,
        actor_role=actor,
        note=payload.seller_response_note,
        access_token=current_user.access_token,
    )
    queue_transaction_notification_jobs(
        recipient_user_id=(
            current_booking["buyer_id"]
            if actor == "seller"
            else _get_seller_user_id(seller_id=current_booking["seller_id"])
        ),
        transaction_kind="booking",
        transaction_id=booking_id,
        event_id=event["id"],
        status_value=payload.status,
        actor_role=actor,
        note=payload.seller_response_note,
    )

    return _get_booking_by_id(booking_id=booking_id, access_token=current_user.access_token)


def _resolve_booking_actor(*, current_user: CurrentUser, access_token: str | None, seller_id: str) -> str:
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
