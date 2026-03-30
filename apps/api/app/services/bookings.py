from app.dependencies.auth import CurrentUser
from app.schemas.bookings import BookingCreate, BookingRead, BookingStatusUpdate

def get_my_bookings(current_user: CurrentUser) -> list[BookingRead]:
    return []

def get_seller_bookings(current_user: CurrentUser) -> list[BookingRead]:
    return []

def create_booking(current_user: CurrentUser, payload: BookingCreate) -> BookingRead:
    return BookingRead(
        id="mock-booking-id",
        buyer_id=current_user.id,
        seller_id=payload.seller_id,
        listing_id=payload.listing_id,
        status="requested",
        scheduled_start=payload.scheduled_start,
        scheduled_end=payload.scheduled_end,
        notes=payload.notes,
    )

def update_booking_status(current_user: CurrentUser, booking_id: str, payload: BookingStatusUpdate) -> BookingRead:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)

    return BookingRead(
        id=booking_id,
        buyer_id="mock-buyer-id",
        seller_id="mock-seller-id",
        listing_id="mock-listing-id",
        status=payload.status,
        scheduled_start=now,
        scheduled_end=now,
        notes=None,
    )