from fastapi import APIRouter, Depends, status

from app.dependencies.auth import get_current_user
from app.schemas.bookings import BookingCreate, BookingRead, BookingStatusUpdate
from app.services.bookings import create_booking, get_my_bookings, get_seller_bookings, update_booking_status

router = APIRouter()

@router.get("/me", response_model=list[BookingRead])
def read_my_bookings(current_user=Depends(get_current_user)) -> list[BookingRead]:
    return get_my_bookings(current_user)

@router.get("/seller", response_model=list[BookingRead])
def read_seller_bookings(current_user=Depends(get_current_user)) -> list[BookingRead]:
    return get_seller_bookings(current_user)

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