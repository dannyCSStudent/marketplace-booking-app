from datetime import datetime

from pydantic import BaseModel

class OrderItemCreate(BaseModel):
    listing_id: str
    quantity: int


class OrderItemRead(BaseModel):
    id: str
    listing_id: str
    quantity: int
    unit_price_cents: int
    total_price_cents: int
    listing_title: str | None = None

class OrderCreate(BaseModel):
    seller_id: str
    fulfillment: str
    notes: str | None = None
    items: list[OrderItemCreate]

class OrderStatusUpdate(BaseModel):
    status: str
    seller_response_note: str | None = None

class OrderStatusEventRead(BaseModel):
    id: str
    status: str
    actor_role: str
    note: str | None = None
    created_at: datetime

class OrderRead(BaseModel):
    id: str
    buyer_id: str
    seller_id: str
    status: str
    fulfillment: str
    subtotal_cents: int
    total_cents: int
    currency: str = "USD"
    notes: str | None = None
    seller_response_note: str | None = None
    items: list[OrderItemRead] = []
    status_history: list[OrderStatusEventRead] = []
