from datetime import datetime
from decimal import Decimal

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
    buyer_browse_context: str | None = None
    items: list[OrderItemCreate]

class OrderStatusUpdate(BaseModel):
    status: str
    seller_response_note: str | None = None


class OrderBulkStatusUpdateItem(BaseModel):
    order_id: str
    status: str
    seller_response_note: str | None = None


class OrderBulkStatusUpdateRequest(BaseModel):
    updates: list[OrderBulkStatusUpdateItem]
    execution_mode: str = "best_effort"

class OrderStatusEventRead(BaseModel):
    id: str
    status: str
    actor_role: str
    note: str | None = None
    created_at: datetime


class OrderAdminEventRead(BaseModel):
    id: str
    actor_user_id: str
    action: str
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
    delivery_fee_cents: int = 0
    platform_fee_cents: int = 0
    platform_fee_rate: Decimal = Decimal("0")
    notes: str | None = None
    buyer_browse_context: str | None = None
    seller_response_note: str | None = None
    items: list[OrderItemRead] = []
    status_history: list[OrderStatusEventRead] = []


class OrderAdminRead(OrderRead):
    admin_note: str | None = None
    admin_handoff_note: str | None = None
    admin_assignee_user_id: str | None = None
    admin_assigned_at: datetime | None = None
    admin_is_escalated: bool = False
    admin_escalated_at: datetime | None = None
    admin_history: list[OrderAdminEventRead] = []


class OrderAdminSupportUpdate(BaseModel):
    admin_note: str | None = None
    admin_handoff_note: str | None = None
    admin_assignee_user_id: str | None = None
    admin_is_escalated: bool | None = None


class OrderBulkActionFailure(BaseModel):
    id: str
    detail: str


class OrderBulkStatusUpdateResult(BaseModel):
    succeeded_ids: list[str]
    failed: list[OrderBulkActionFailure]
