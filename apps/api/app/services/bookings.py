from decimal import Decimal
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.dependencies.supabase import get_supabase_client
from app.schemas.bookings import (
    BookingAdminEventRead,
    BookingAdminRead,
    BookingAdminSupportUpdate,
    BookingBulkStatusUpdateRequest,
    BookingBulkStatusUpdateResult,
    BookingBulkActionFailure,
    BookingCreate,
    BookingRead,
    BookingStatusEventRead,
    BookingStatusUpdate,
)
from app.services.platform_fees import (
    calculate_platform_fee,
    get_active_platform_fee_rate_value,
)
from app.services.notification_delivery_worker import process_notification_delivery_rows
from app.services.response_ai import build_transaction_response_ai_response
from app.services.workflows import BOOKING_TRANSITIONS_BY_ACTOR, validate_transition
from app.services.notifications import queue_transaction_notification_jobs

BOOKING_SELECT = (
    "id,buyer_id,seller_id,listing_id,status,scheduled_start,scheduled_end,total_cents,currency,"
    "platform_fee_cents,platform_fee_rate,"
    "seller_response_note,"
    "notes,buyer_browse_context,listings(title,type,is_local_only,auto_accept_bookings),booking_status_events(id,status,actor_role,note,created_at)"
)
BOOKING_ADMIN_SELECT = (
    f"{BOOKING_SELECT},admin_note,admin_handoff_note,admin_assignee_user_id,admin_assigned_at,admin_is_escalated,admin_escalated_at,"
    "booking_admin_events(id,actor_user_id,action,note,created_at)"
)


def _serialize_booking(row: dict, *, include_admin: bool = False) -> BookingRead | BookingAdminRead:
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
    base_payload = dict(
        id=row["id"],
        buyer_id=row["buyer_id"],
        seller_id=row["seller_id"],
        listing_id=row["listing_id"],
        status=row["status"],
        scheduled_start=row["scheduled_start"],
        scheduled_end=row["scheduled_end"],
        total_cents=row.get("total_cents"),
        currency=row.get("currency") or "USD",
        platform_fee_cents=row.get("platform_fee_cents", 0),
        platform_fee_rate=Decimal(str(row.get("platform_fee_rate", 0))),
        notes=row.get("notes"),
        buyer_browse_context=row.get("buyer_browse_context"),
        seller_response_note=row.get("seller_response_note"),
        listing_title=listing.get("title"),
        listing_type=listing.get("type"),
        is_local_only=listing.get("is_local_only"),
        status_history=status_history,
    )
    if include_admin:
        admin_history = [
            BookingAdminEventRead(
                id=event["id"],
                actor_user_id=event["actor_user_id"],
                action=event["action"],
                note=event.get("note"),
                created_at=event["created_at"],
            )
            for event in sorted(
                row.get("booking_admin_events", []),
                key=lambda event: event.get("created_at") or "",
                reverse=True,
            )
        ]
        return BookingAdminRead(
            **base_payload,
            admin_note=row.get("admin_note"),
            admin_handoff_note=row.get("admin_handoff_note"),
            admin_assignee_user_id=row.get("admin_assignee_user_id"),
            admin_assigned_at=row.get("admin_assigned_at"),
            admin_is_escalated=bool(row.get("admin_is_escalated", False)),
            admin_escalated_at=row.get("admin_escalated_at"),
            admin_history=admin_history,
        )

    return BookingRead(**base_payload)


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


def _get_booking_row_by_id(*, booking_id: str, access_token: str) -> dict:
    supabase = get_supabase_client()
    try:
        return supabase.select(
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


def _booking_windows_overlap(
    start_a: datetime,
    end_a: datetime,
    start_b: datetime,
    end_b: datetime,
) -> bool:
    return start_a < end_b and end_a > start_b


def _find_booking_conflicts(
    *,
    listing_id: str,
    scheduled_start: datetime,
    scheduled_end: datetime,
    supabase,
) -> list[dict]:
    try:
        rows = supabase.select(
            "bookings",
            query={
                "select": "id,status,scheduled_start,scheduled_end",
                "listing_id": f"eq.{listing_id}",
                "status": "in.(requested,confirmed,in_progress)",
            },
            use_service_role=True,
        )
    except SupabaseError:
        return []

    conflicts: list[dict] = []
    for row in rows:
        existing_start = row.get("scheduled_start")
        existing_end = row.get("scheduled_end")
        if not isinstance(existing_start, str) or not isinstance(existing_end, str):
            continue

        try:
            parsed_start = datetime.fromisoformat(existing_start.replace("Z", "+00:00"))
            parsed_end = datetime.fromisoformat(existing_end.replace("Z", "+00:00"))
        except ValueError:
            continue

        if _booking_windows_overlap(scheduled_start, scheduled_end, parsed_start, parsed_end):
            conflicts.append(row)

    return conflicts


def _queue_booking_conflict_alert_notification(
    *,
    seller_user_id: str | None,
    seller_id: str,
    seller_slug: str,
    seller_display_name: str,
    booking_id: str,
    listing_id: str,
    listing_title: str | None,
    scheduled_start: datetime,
    scheduled_end: datetime,
    conflicts: list[dict],
) -> None:
    if not seller_user_id:
        return

    alert_signature = f"booking-conflict:{listing_id}:{booking_id}"
    try:
        supabase = get_supabase_client()
        existing = supabase.select(
            "notification_deliveries",
            query={
                "select": "id",
                "event_id": f"eq.{alert_signature}",
            },
            use_service_role=True,
        )
    except SupabaseError:
        existing = []

    if existing:
        return

    conflict_count = len(conflicts)
    conflict_booking_ids = [str(row.get("id")) for row in conflicts if row.get("id")]
    subject = f"Booking conflict detected for {listing_title or listing_id}"
    body = (
        f"{listing_title or listing_id} has {conflict_count} overlapping booking"
        f"{'' if conflict_count == 1 else 's'}."
    )
    html = (
        f"<p>Booking conflict detected for <strong>{listing_title or listing_id}</strong>.</p>"
        f"<p><strong>Overlaps:</strong> {conflict_count}</p>"
        f"<p><strong>Conflicting booking IDs:</strong> {', '.join(conflict_booking_ids) or 'none'}</p>"
        f"<p><strong>Window:</strong> {scheduled_start.isoformat()} to {scheduled_end.isoformat()}</p>"
    )

    deliveries = [
        {
            "recipient_user_id": seller_user_id,
            "transaction_kind": "booking",
            "transaction_id": booking_id,
            "event_id": alert_signature,
            "channel": "email",
            "delivery_status": "queued",
            "payload": {
                "alert_type": "booking_conflict",
                "seller_id": seller_id,
                "seller_slug": seller_slug,
                "seller_display_name": seller_display_name,
                "booking_id": booking_id,
                "listing_id": listing_id,
                "listing_title": listing_title,
                "conflict_booking_ids": conflict_booking_ids,
                "conflict_count": conflict_count,
                "scheduled_start": scheduled_start.isoformat(),
                "scheduled_end": scheduled_end.isoformat(),
                "alert_signature": alert_signature,
                "subject": subject,
                "body": body,
                "html": html,
            },
        },
        {
            "recipient_user_id": seller_user_id,
            "transaction_kind": "booking",
            "transaction_id": booking_id,
            "event_id": alert_signature,
            "channel": "push",
            "delivery_status": "queued",
            "payload": {
                "alert_type": "booking_conflict",
                "seller_id": seller_id,
                "seller_slug": seller_slug,
                "seller_display_name": seller_display_name,
                "booking_id": booking_id,
                "listing_id": listing_id,
                "listing_title": listing_title,
                "conflict_booking_ids": conflict_booking_ids,
                "conflict_count": conflict_count,
                "scheduled_start": scheduled_start.isoformat(),
                "scheduled_end": scheduled_end.isoformat(),
                "alert_signature": alert_signature,
                "subject": subject,
                "body": body,
                "html": html,
            },
        },
    ]

    try:
        inserted_rows = supabase.insert("notification_deliveries", deliveries, use_service_role=True)
    except SupabaseError:
        return

    if inserted_rows:
        try:
            process_notification_delivery_rows(inserted_rows)
        except Exception:
            return

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


def get_booking_by_id_for_user(current_user: CurrentUser, booking_id: str) -> BookingRead:
    return _get_booking_by_id(booking_id=booking_id, access_token=current_user.access_token)


def get_admin_bookings() -> list[BookingAdminRead]:
    supabase = get_supabase_client()
    try:
        rows = supabase.select(
            "bookings",
            query={
                "select": BOOKING_ADMIN_SELECT,
                "order": "created_at.desc",
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return [_serialize_booking(row, include_admin=True) for row in rows]


def _insert_booking_admin_events(
    *,
    booking_id: str,
    actor_user_id: str,
    events: list[dict[str, str | None]],
) -> None:
    if not events:
        return

    supabase = get_supabase_client()
    try:
        supabase.insert(
            "booking_admin_events",
            [
                {
                    "booking_id": booking_id,
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


def update_admin_booking_support(
    booking_id: str,
    payload: BookingAdminSupportUpdate,
    *,
    actor_user_id: str,
) -> BookingAdminRead:
    supabase = get_supabase_client()
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No admin support changes provided")

    try:
        current_row = supabase.select(
            "bookings",
            query={
                "select": BOOKING_ADMIN_SELECT,
                "id": f"eq.{booking_id}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found") from exc
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
            "bookings",
            updates,
            query={
                "id": f"eq.{booking_id}",
                "select": BOOKING_ADMIN_SELECT,
            },
            use_service_role=True,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")

    _insert_booking_admin_events(booking_id=booking_id, actor_user_id=actor_user_id, events=admin_events)
    return _serialize_booking(rows[0], include_admin=True)


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
                    "id,seller_id,title,price_cents,currency,status,type,requires_booking,"
                    "duration_minutes,lead_time_hours,auto_accept_bookings"
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

    price_cents = listing.get("price_cents")
    if price_cents is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Booking requires a priced listing")

    platform_fee_rate = get_active_platform_fee_rate_value()
    platform_fee_cents = calculate_platform_fee(price_cents, platform_fee_rate)
    total_cents = price_cents + platform_fee_cents
    auto_accept_bookings = bool(listing.get("auto_accept_bookings"))
    scheduled_conflicts = _find_booking_conflicts(
        listing_id=payload.listing_id,
        scheduled_start=scheduled_start,
        scheduled_end=scheduled_end,
        supabase=supabase,
    )
    booking_status = "confirmed" if auto_accept_bookings and not scheduled_conflicts else "requested"
    try:
        seller = supabase.select(
            "seller_profiles",
            query={
                "select": "id,slug,display_name,user_id",
                "id": f"eq.{payload.seller_id}",
            },
            use_service_role=True,
            expect_single=True,
        )
    except SupabaseError as exc:
        if exc.status_code == 406:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seller profile not found") from exc
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    seller_user_id = seller.get("user_id")

    try:
        rows = supabase.insert(
            "bookings",
            {
                "buyer_id": current_user.id,
                "seller_id": payload.seller_id,
                "listing_id": payload.listing_id,
                "status": booking_status,
                "scheduled_start": scheduled_start.isoformat(),
                "scheduled_end": scheduled_end.isoformat(),
                "total_cents": total_cents,
                "currency": listing.get("currency") or "USD",
                "platform_fee_cents": platform_fee_cents,
                "platform_fee_rate": str(platform_fee_rate),
                "notes": payload.notes,
                "buyer_browse_context": payload.buyer_browse_context,
            },
            access_token=current_user.access_token,
        )
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    booking = rows[0]
    event_note = (
        "Auto-confirmed by listing settings."
        if booking_status == "confirmed"
        else payload.notes
    )
    event = _insert_booking_status_event(
        booking_id=booking["id"],
        status_value=booking_status,
        actor_role="system" if booking_status == "confirmed" else "buyer",
        note=event_note,
        access_token=current_user.access_token,
    )
    if booking_status == "confirmed":
        auto_accept_note = "This booking was auto-confirmed by the listing's booking settings."
        queue_transaction_notification_jobs(
            recipient_user_id=current_user.id,
            transaction_kind="booking",
            transaction_id=booking["id"],
            event_id=event["id"],
            status_value=booking_status,
            actor_role="system",
            note=auto_accept_note,
        )
        queue_transaction_notification_jobs(
            recipient_user_id=seller_user_id,
            transaction_kind="booking",
            transaction_id=booking["id"],
            event_id=event["id"],
            status_value=booking_status,
            actor_role="system",
            note="A booking request auto-confirmed through this listing's settings.",
        )
    elif auto_accept_bookings and scheduled_conflicts:
        queue_transaction_notification_jobs(
            recipient_user_id=seller_user_id,
            transaction_kind="booking",
            transaction_id=booking["id"],
            event_id=event["id"],
            status_value=booking_status,
            actor_role="buyer",
            note="Booking request overlaps another active booking and needs manual review.",
        )
        _queue_booking_conflict_alert_notification(
            seller_user_id=seller_user_id,
            seller_id=seller["id"],
            seller_slug=seller["slug"],
            seller_display_name=seller["display_name"],
            booking_id=booking["id"],
            listing_id=listing["id"],
            listing_title=listing.get("title") if isinstance(listing.get("title"), str) else None,
            scheduled_start=scheduled_start,
            scheduled_end=scheduled_end,
            conflicts=scheduled_conflicts,
        )
    else:
        queue_transaction_notification_jobs(
            recipient_user_id=seller_user_id,
            transaction_kind="booking",
            transaction_id=booking["id"],
            event_id=event["id"],
            status_value=booking_status,
            actor_role="buyer",
            note=payload.notes,
        )

    return _get_booking_by_id(booking_id=booking["id"], access_token=current_user.access_token)

def update_booking_status(current_user: CurrentUser, booking_id: str, payload: BookingStatusUpdate) -> BookingRead:
    supabase = get_supabase_client()
    current_booking = _get_booking_row_by_id(
        booking_id=booking_id,
        access_token=current_user.access_token,
    )

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


def generate_booking_response_ai_assist(current_user: CurrentUser, booking_id: str):
    current_booking = _get_booking_row_by_id(
        booking_id=booking_id,
        access_token=current_user.access_token,
    )
    return build_transaction_response_ai_response(
        transaction_kind="booking",
        transaction_id=booking_id,
        transaction_status=current_booking["status"],
        buyer_notes=current_booking.get("notes"),
        buyer_context=current_booking.get("buyer_browse_context"),
        transaction_label=current_booking.get("listing_title") or current_booking.get("listing_id"),
    )


def _validate_booking_status_update(
    current_user: CurrentUser,
    booking_id: str,
    payload: BookingStatusUpdate,
) -> None:
    current_booking = _get_booking_row_by_id(
        booking_id=booking_id,
        access_token=current_user.access_token,
    )
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


def bulk_update_booking_statuses(
    current_user: CurrentUser,
    payload: BookingBulkStatusUpdateRequest,
) -> BookingBulkStatusUpdateResult:
    succeeded_ids: list[str] = []
    failed: list[BookingBulkActionFailure] = []
    atomic_mode = payload.execution_mode == "atomic"

    if atomic_mode:
        preflight_failures: list[BookingBulkActionFailure] = []
        for item in payload.updates:
            try:
                _validate_booking_status_update(
                    current_user,
                    item.booking_id,
                    BookingStatusUpdate(
                        status=item.status,
                        seller_response_note=item.seller_response_note,
                    ),
                )
            except HTTPException as exc:
                preflight_failures.append(
                    BookingBulkActionFailure(id=item.booking_id, detail=str(exc.detail)),
                )

        if preflight_failures:
            return BookingBulkStatusUpdateResult(succeeded_ids=[], failed=preflight_failures)

    for item in payload.updates:
        try:
            update_booking_status(
                current_user,
                item.booking_id,
                BookingStatusUpdate(
                    status=item.status,
                    seller_response_note=item.seller_response_note,
                ),
            )
            succeeded_ids.append(item.booking_id)
        except HTTPException as exc:
            failed.append(BookingBulkActionFailure(id=item.booking_id, detail=str(exc.detail)))

    return BookingBulkStatusUpdateResult(succeeded_ids=succeeded_ids, failed=failed)


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
