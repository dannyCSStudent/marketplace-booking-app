from fastapi import APIRouter, Depends

from app.dependencies.admin import require_admin_user
from app.schemas.platform_fees import DeliveryFeeSettingsCreate, DeliveryFeeSettingsRead
from app.services.delivery_fees import (
    create_delivery_fee_settings,
    get_active_delivery_fee_settings,
)

router = APIRouter()


@router.get("", response_model=DeliveryFeeSettingsRead)
def read_delivery_fee_settings() -> DeliveryFeeSettingsRead:
    return DeliveryFeeSettingsRead(**get_active_delivery_fee_settings())


@router.post("", response_model=DeliveryFeeSettingsRead)
def create_delivery_fee_settings_record(
    payload: DeliveryFeeSettingsCreate,
    current_user=Depends(require_admin_user),
) -> DeliveryFeeSettingsRead:
    record = create_delivery_fee_settings(
        name=payload.name,
        delivery_fee_cents=payload.delivery_fee_cents,
        shipping_fee_cents=payload.shipping_fee_cents,
        effective_at=payload.effective_at,
    )
    return DeliveryFeeSettingsRead(**record)
