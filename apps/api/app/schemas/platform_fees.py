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
