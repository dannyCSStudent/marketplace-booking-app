import unittest
from unittest.mock import patch

from app.dependencies.auth import CurrentUser
from app.schemas.listings import ListingCreate
from app.services.listings import create_listing


USER = CurrentUser(
    id="buyer-user-id",
    email="buyer@example.com",
    access_token="buyer-token",
)


class ListingInventoryAlertTests(unittest.TestCase):
    def test_create_listing_queues_inventory_alert_notifications_for_low_stock(self):
        class _Supabase:
            def __init__(self):
                self.insert_calls = []
                self.select_calls = []

            def insert(self, table, payload, **kwargs):
                self.insert_calls.append((table, payload, kwargs))
                if table == "listings":
                    return [
                        {
                            "id": "listing-1",
                            "seller_id": "seller-1",
                            "category_id": None,
                            "title": "Fresh tamales",
                            "slug": "fresh-tamales",
                            "description": None,
                            "type": "product",
                            "status": "active",
                            "price_cents": 2500,
                            "currency": "USD",
                            "inventory_count": 3,
                            "requires_booking": False,
                            "duration_minutes": None,
                            "is_local_only": True,
                            "city": "Dallas",
                            "state": "TX",
                            "country": "USA",
                            "pickup_enabled": True,
                            "meetup_enabled": False,
                            "delivery_enabled": False,
                            "shipping_enabled": False,
                            "lead_time_hours": None,
                            "images": [],
                            "created_at": "2026-04-08T12:00:00+00:00",
                            "updated_at": "2026-04-08T12:00:00+00:00",
                            "last_operating_adjustment_at": None,
                            "last_operating_adjustment_summary": None,
                            "last_pricing_comparison_scope": None,
                            "available_today": False,
                            "is_new_listing": True,
                            "recent_transaction_count": 0,
                            "is_promoted": False,
                        }
                    ]
                if table == "notification_deliveries":
                    return payload
                raise AssertionError(f"Unexpected insert table: {table}")

            def select(self, table, **kwargs):
                self.select_calls.append((table, kwargs))
                if table == "notification_deliveries":
                    return []
                raise AssertionError(f"Unexpected select table: {table}")

        fake_supabase = _Supabase()
        seller = type(
            "Seller",
            (),
            {
                "id": "seller-1",
                "user_id": "seller-user-id",
                "slug": "south-dallas-tamales",
                "display_name": "South Dallas Tamales",
            },
        )()

        with (
            patch("app.services.listings.get_supabase_client", return_value=fake_supabase),
            patch("app.services.listings.get_seller_by_id", return_value=seller),
            patch("app.services.listings.process_notification_delivery_rows") as mock_process_rows,
        ):
            listing = create_listing(
                USER,
                ListingCreate(
                    seller_id="seller-1",
                    title="Fresh tamales",
                    slug="fresh-tamales",
                    description="Hot tamales ready today.",
                    type="product",
                    status="active",
                    price_cents=2500,
                    inventory_count=3,
                    pickup_enabled=True,
                    delivery_enabled=False,
                    meetup_enabled=False,
                    shipping_enabled=False,
                ),
            )

        self.assertEqual(listing.inventory_count, 3)
        self.assertEqual(fake_supabase.insert_calls[0][0], "listings")
        self.assertEqual(fake_supabase.insert_calls[1][0], "notification_deliveries")
        self.assertEqual(len(fake_supabase.insert_calls[1][1]), 2)
        first_delivery = fake_supabase.insert_calls[1][1][0]
        self.assertEqual(first_delivery["payload"]["alert_type"], "inventory_alert")
        self.assertEqual(first_delivery["payload"]["inventory_bucket"], "low_stock")
        self.assertEqual(first_delivery["event_id"], "listing-inventory-alert:listing-1:low_stock")
        mock_process_rows.assert_called_once()


if __name__ == "__main__":
    unittest.main()
