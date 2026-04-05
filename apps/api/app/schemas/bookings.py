from datetime import datetime

from pydantic import BaseModel

class BookingCreate(BaseModel):
    seller_id: str
    listing_id: str
    scheduled_start: datetime
    scheduled_end: datetime
    notes: str | None = None

class BookingStatusUpdate(BaseModel):
    status: str
    seller_response_note: str | None = None


class BookingBulkStatusUpdateItem(BaseModel):
    booking_id: str
    status: str
    seller_response_note: str | None = None


class BookingBulkStatusUpdateRequest(BaseModel):
    updates: list[BookingBulkStatusUpdateItem]
    execution_mode: str = "best_effort"

class BookingStatusEventRead(BaseModel):
    id: str
    status: str
    actor_role: str
    note: str | None = None
    created_at: datetime

class BookingRead(BaseModel):
    id: str
    buyer_id: str
    seller_id: str
    listing_id: str
    status: str
    scheduled_start: datetime
    scheduled_end: datetime
    total_cents: int | None = None
    currency: str = "USD"
    notes: str | None = None
    seller_response_note: str | None = None
    listing_title: str | None = None
    listing_type: str | None = None
    status_history: list[BookingStatusEventRead] = []


class BookingBulkActionFailure(BaseModel):
    id: str
    detail: str


class BookingBulkStatusUpdateResult(BaseModel):
    succeeded_ids: list[str]
    failed: list[BookingBulkActionFailure]
