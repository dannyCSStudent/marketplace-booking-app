from app.dependencies.auth import CurrentUser
from app.schemas.orders import OrderCreate, OrderRead, OrderStatusUpdate

def get_my_orders(current_user: CurrentUser) -> list[OrderRead]:
    return [
        OrderRead(
            id="mock-order-id",
            buyer_id=current_user.id,
            seller_id="mock-seller-id",
            status="pending",
            fulfillment="pickup",
            subtotal_cents=2000,
            total_cents=2000,
            currency="USD",
            notes=None,
        )
    ]

def get_seller_orders(current_user: CurrentUser) -> list[OrderRead]:
    return [
        OrderRead(
            id="mock-order-id",
            buyer_id="mock-buyer-id",
            seller_id="mock-seller-id",
            status="pending",
            fulfillment="pickup",
            subtotal_cents=2000,
            total_cents=2000,
            currency="USD",
            notes=None,
        )
    ]

def create_order(current_user: CurrentUser, payload: OrderCreate) -> OrderRead:
    subtotal = 0
    for item in payload.items:
        subtotal += item.quantity * 1000

    return OrderRead(
        id="mock-order-id",
        buyer_id=current_user.id,
        seller_id=payload.seller_id,
        status="pending",
        fulfillment=payload.fulfillment,
        subtotal_cents=subtotal,
        total_cents=subtotal,
        currency="USD",
        notes=payload.notes,
    )

def update_order_status(current_user: CurrentUser, order_id: str, payload: OrderStatusUpdate) -> OrderRead:
    return OrderRead(
        id=order_id,
        buyer_id="mock-buyer-id",
        seller_id="mock-seller-id",
        status=payload.status,
        fulfillment="pickup",
        subtotal_cents=2000,
        total_cents=2000,
        currency="USD",
        notes=None,
    )