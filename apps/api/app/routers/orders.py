from fastapi import APIRouter, Depends, status

from app.dependencies.admin import require_admin_user
from app.dependencies.auth import get_current_user
from app.schemas.orders import (
    OrderAdminRead,
    OrderAdminSupportUpdate,
    OrderBulkStatusUpdateRequest,
    OrderBulkStatusUpdateResult,
    OrderCreate,
    OrderRead,
    OrderResponseAiAssistResponse,
    OrderStatusUpdate,
)
from app.services.orders import (
    bulk_update_order_statuses,
    create_order,
    get_admin_orders,
    get_order_by_id_for_user,
    get_my_orders,
    get_seller_orders,
    generate_order_response_ai_assist,
    update_admin_order_support,
    update_order_status,
)

router = APIRouter()

@router.get("/me", response_model=list[OrderRead])
def read_my_orders(current_user=Depends(get_current_user)) -> list[OrderRead]:
    return get_my_orders(current_user)

@router.get("/seller", response_model=list[OrderRead])
def read_seller_orders(current_user=Depends(get_current_user)) -> list[OrderRead]:
    return get_seller_orders(current_user)


@router.get("/admin", response_model=list[OrderAdminRead])
def read_admin_orders(current_user=Depends(require_admin_user)) -> list[OrderAdminRead]:
    return get_admin_orders()


@router.patch("/{order_id}/admin-support", response_model=OrderAdminRead)
def patch_admin_order_support(
    order_id: str,
    payload: OrderAdminSupportUpdate,
    current_user=Depends(require_admin_user),
) -> OrderAdminRead:
    return update_admin_order_support(order_id, payload, actor_user_id=current_user.id)


@router.get("/{order_id}", response_model=OrderRead)
def read_order_by_id(
    order_id: str,
    current_user=Depends(get_current_user),
) -> OrderRead:
    return get_order_by_id_for_user(current_user, order_id)

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


@router.post("/{order_id}/response-ai-assist", response_model=OrderResponseAiAssistResponse)
def request_order_response_ai_assist(
    order_id: str,
    current_user=Depends(get_current_user),
) -> OrderResponseAiAssistResponse:
    return generate_order_response_ai_assist(current_user, order_id)


@router.post("/bulk-status", response_model=OrderBulkStatusUpdateResult)
def bulk_patch_order_status(
    payload: OrderBulkStatusUpdateRequest,
    current_user=Depends(get_current_user),
) -> OrderBulkStatusUpdateResult:
    return bulk_update_order_statuses(current_user, payload)
