from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class PlatformFeeRateRead(BaseModel):
    id: str | None = None
    name: str
    rate: Decimal
    effective_at: datetime | None = None


class PlatformFeeRateCreate(BaseModel):
    name: str
    rate: Decimal
    effective_at: datetime | None = None


class PlatformFeeHistoryPoint(BaseModel):
    date: str
    order_fee_cents: int
    booking_fee_cents: int


class DeliveryFeeHistoryPoint(BaseModel):
    date: str
    delivery_fee_cents: int
    shipping_fee_cents: int


class DeliveryFeeSettingsRead(BaseModel):
    id: str | None = None
    name: str
    delivery_fee_cents: int = 0
    shipping_fee_cents: int = 0
    effective_at: datetime | None = None


class DeliveryFeeSettingsCreate(BaseModel):
    name: str
    delivery_fee_cents: int = 0
    shipping_fee_cents: int = 0
    effective_at: datetime | None = None
