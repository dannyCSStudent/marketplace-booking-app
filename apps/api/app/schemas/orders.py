from pydantic import BaseModel

class OrderItemCreate(BaseModel):
    listing_id: str
    quantity: int

class OrderCreate(BaseModel):
    seller_id: str
    fulfillment: str
    notes: str | None = None
    items: list[OrderItemCreate]

class OrderStatusUpdate(BaseModel):
    status: str

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