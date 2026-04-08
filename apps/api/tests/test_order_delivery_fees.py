import unittest
from unittest.mock import patch
from decimal import Decimal

from app.dependencies.auth import CurrentUser
from app.schemas.orders import OrderCreate, OrderItemCreate
from app.services.orders import create_order


BUYER_USER = CurrentUser(id="buyer-user-id", email="buyer@example.com", access_token="buyer-token")


class OrderDeliveryFeeTests(unittest.TestCase):
    def test_applies_platform_added_delivery_fee_for_delivery_orders(self):
        fake_supabase = _CreateOrderSupabase(
            listing_rows=[
                {
                    "id": "listing-1",
                    "seller_id": "seller-profile-id",
                    "price_cents": 1800,
                    "currency": "USD",
                    "status": "active",
                    "type": "product",
                    "pickup_enabled": True,
                    "meetup_enabled": False,
                    "delivery_enabled": True,
                    "shipping_enabled": False,
                }
            ],
            created_order={
                "id": "order-1",
                "buyer_id": BUYER_USER.id,
                "seller_id": "seller-profile-id",
                "status": "pending",
                "fulfillment": "delivery",
                "subtotal_cents": 1800,
                "delivery_fee_cents": 499,
                "platform_fee_cents": 90,
                "platform_fee_rate": "0.0500",
                "total_cents": 2389,
                "currency": "USD",
                "notes": None,
                "buyer_browse_context": None,
                "seller_response_note": None,
            },
        )

        with (
            patch("app.services.orders.get_supabase_client", return_value=fake_supabase),
            patch("app.services.orders.get_platform_added_delivery_fee_cents", return_value=499),
            patch("app.services.orders.get_active_platform_fee_rate_value", return_value=Decimal("0.0500")),
            patch("app.services.orders._insert_order_status_event", return_value={"id": "event-1"}),
            patch("app.services.orders._get_order_by_id", return_value=fake_supabase.serialized_order),
            patch("app.services.orders._get_seller_user_id", return_value="seller-user-id"),
            patch("app.services.orders.queue_transaction_notification_jobs"),
        ):
            result = create_order(
                BUYER_USER,
                OrderCreate(
                    seller_id="seller-profile-id",
                    fulfillment="delivery",
                    items=[OrderItemCreate(listing_id="listing-1", quantity=1)],
                ),
            )

        self.assertEqual(result["delivery_fee_cents"], 499)
        self.assertEqual(result["total_cents"], 2389)
        self.assertEqual(fake_supabase.orders_insert_payload["delivery_fee_cents"], 499)
        self.assertEqual(fake_supabase.orders_insert_payload["total_cents"], 2389)


class _CreateOrderSupabase:
    def __init__(self, *, listing_rows, created_order):
        self.listing_rows = listing_rows
        self.created_order = created_order
        self.orders_insert_payload = None
        self.serialized_order = created_order | {
            "order_items": [],
            "order_status_events": [],
        }

    def select(self, table, *args, **kwargs):
        if table == "listings":
            return self.listing_rows
        raise AssertionError(f"Unexpected select call for {table}")

    def insert(self, table, payload, *args, **kwargs):
        if table == "orders":
            self.orders_insert_payload = payload
            return [self.created_order]
        if table == "order_items":
            return payload
        raise AssertionError(f"Unexpected insert call for {table}")


if __name__ == "__main__":
    unittest.main()
