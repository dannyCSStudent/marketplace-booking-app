from fastapi import APIRouter, Depends, status

from app.dependencies.admin import require_admin_user
from app.dependencies.auth import get_current_user
from app.schemas.bookings import (
    BookingAdminRead,
    BookingAdminSupportUpdate,
    BookingBulkStatusUpdateRequest,
    BookingBulkStatusUpdateResult,
    BookingCreate,
    BookingRead,
    BookingStatusUpdate,
)
from app.services.bookings import (
    bulk_update_booking_statuses,
    create_booking,
    get_admin_bookings,
    get_booking_by_id_for_user,
    get_my_bookings,
    get_seller_bookings,
    update_admin_booking_support,
    update_booking_status,
)

router = APIRouter()

@router.get("/me", response_model=list[BookingRead])
def read_my_bookings(current_user=Depends(get_current_user)) -> list[BookingRead]:
    return get_my_bookings(current_user)

@router.get("/seller", response_model=list[BookingRead])
def read_seller_bookings(current_user=Depends(get_current_user)) -> list[BookingRead]:
    return get_seller_bookings(current_user)


@router.get("/admin", response_model=list[BookingAdminRead])
def read_admin_bookings(current_user=Depends(require_admin_user)) -> list[BookingAdminRead]:
    return get_admin_bookings()


@router.patch("/{booking_id}/admin-support", response_model=BookingAdminRead)
def patch_admin_booking_support(
    booking_id: str,
    payload: BookingAdminSupportUpdate,
    current_user=Depends(require_admin_user),
) -> BookingAdminRead:
    return update_admin_booking_support(booking_id, payload, actor_user_id=current_user.id)


@router.get("/{booking_id}", response_model=BookingRead)
def read_booking_by_id(
    booking_id: str,
    current_user=Depends(get_current_user),
) -> BookingRead:
    return get_booking_by_id_for_user(current_user, booking_id)

@router.post("", response_model=BookingRead, status_code=status.HTTP_201_CREATED)
def create_my_booking(
    payload: BookingCreate,
    current_user=Depends(get_current_user),
) -> BookingRead:
    return create_booking(current_user, payload)

@router.patch("/{booking_id}", response_model=BookingRead)
def patch_booking_status(
    booking_id: str,
    payload: BookingStatusUpdate,
    current_user=Depends(get_current_user),
) -> BookingRead:
    return update_booking_status(current_user, booking_id, payload)


@router.post("/bulk-status", response_model=BookingBulkStatusUpdateResult)
def bulk_patch_booking_status(
    payload: BookingBulkStatusUpdateRequest,
    current_user=Depends(get_current_user),
) -> BookingBulkStatusUpdateResult:
    return bulk_update_booking_statuses(current_user, payload)
