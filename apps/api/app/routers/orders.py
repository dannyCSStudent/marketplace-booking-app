from fastapi import APIRouter, Depends, status

from app.dependencies.auth import get_current_user
from app.schemas.orders import (
    OrderBulkStatusUpdateRequest,
    OrderBulkStatusUpdateResult,
    OrderCreate,
    OrderRead,
    OrderStatusUpdate,
)
from app.services.orders import (
    bulk_update_order_statuses,
    create_order,
    get_my_orders,
    get_seller_orders,
    update_order_status,
)

router = APIRouter()

@router.get("/me", response_model=list[OrderRead])
def read_my_orders(current_user=Depends(get_current_user)) -> list[OrderRead]:
    return get_my_orders(current_user)

@router.get("/seller", response_model=list[OrderRead])
def read_seller_orders(current_user=Depends(get_current_user)) -> list[OrderRead]:
    return get_seller_orders(current_user)

@router.post("", response_model=OrderRead, status_code=status.HTTP_201_CREATED)
def create_my_order(
    payload: OrderCreate,
    current_user=Depends(get_current_user),
) -> OrderRead:
    return create_order(current_user, payload)

@router.patch("/{order_id}", response_model=OrderRead)
def patch_order_status(
    order_id: str,
    payload: OrderStatusUpdate,
    current_user=Depends(get_current_user),
) -> OrderRead:
    return update_order_status(current_user, order_id, payload)


@router.post("/bulk-status", response_model=OrderBulkStatusUpdateResult)
def bulk_patch_order_status(
    payload: OrderBulkStatusUpdateRequest,
    current_user=Depends(get_current_user),
) -> OrderBulkStatusUpdateResult:
    return bulk_update_order_statuses(current_user, payload)
