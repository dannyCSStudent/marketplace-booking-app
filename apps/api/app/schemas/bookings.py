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

class BookingRead(BaseModel):
    id: str
    buyer_id: str
    seller_id: str
    listing_id: str
    status: str
    scheduled_start: datetime
    scheduled_end: datetime
    notes: str | None = None