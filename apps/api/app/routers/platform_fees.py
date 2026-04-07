from fastapi import APIRouter

from app.schemas.platform_fees import PlatformFeeRateCreate, PlatformFeeRateRead
from app.services.platform_fees import (
    create_platform_fee_rate_record,
    get_active_platform_fee_rate_record,
)

router = APIRouter()


@router.get("", response_model=PlatformFeeRateRead)
def read_platform_fee_rate() -> PlatformFeeRateRead:
    return PlatformFeeRateRead(**get_active_platform_fee_rate_record())


@router.post("", response_model=PlatformFeeRateRead)
def create_platform_fee_rate(payload: PlatformFeeRateCreate) -> PlatformFeeRateRead:
    record = create_platform_fee_rate_record(
        name=payload.name,
        rate=payload.rate,
        effective_at=payload.effective_at,
    )
    return PlatformFeeRateRead(**record)
