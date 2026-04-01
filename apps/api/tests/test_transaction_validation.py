from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.dependencies.auth import CurrentUser
from app.schemas.bookings import BookingCreate
from app.schemas.orders import OrderCreate, OrderItemCreate
from app.services.bookings import create_booking
from app.services.orders import create_order


BUYER_USER = CurrentUser(id="buyer-user-id", email="buyer@example.com", access_token="buyer-token")


class OrderCreationValidationTests(unittest.TestCase):
    def test_rejects_unsupported_fulfillment_for_listing(self):
        fake_supabase = _ValidationSupabase(
            select_results=[[
                {
                    "id": "listing-1",
                    "seller_id": "seller-profile-id",
                    "price_cents": 1800,
                    "currency": "USD",
                    "status": "active",
                    "type": "product",
                    "pickup_enabled": True,
                    "meetup_enabled": False,
                    "delivery_enabled": False,
                    "shipping_enabled": False,
                }
            ]]
        )

        with patch("app.services.orders.get_supabase_client", return_value=fake_supabase):
            with self.assertRaises(HTTPException) as context:
                create_order(
                    BUYER_USER,
                    OrderCreate(
                        seller_id="seller-profile-id",
                        fulfillment="delivery",
                        items=[OrderItemCreate(listing_id="listing-1", quantity=1)],
                    ),
                )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("does not support delivery", context.exception.detail)
        self.assertEqual(fake_supabase.insert_calls, 0)


class BookingCreationValidationTests(unittest.TestCase):
    def test_rejects_booking_before_lead_time(self):
        now = datetime.now(timezone.utc)
        fake_supabase = _ValidationSupabase(
            select_results=[
                {
                    "id": "listing-1",
                    "seller_id": "seller-profile-id",
                    "price_cents": 4500,
                    "currency": "USD",
                    "status": "active",
                    "type": "service",
                    "requires_booking": True,
                    "duration_minutes": 90,
                    "lead_time_hours": 24,
                }
            ]
        )

        with patch("app.services.bookings.get_supabase_client", return_value=fake_supabase):
            with self.assertRaises(HTTPException) as context:
                create_booking(
                    BUYER_USER,
                    BookingCreate(
                        seller_id="seller-profile-id",
                        listing_id="listing-1",
                        scheduled_start=now + timedelta(hours=6),
                        scheduled_end=now + timedelta(hours=7, minutes=30),
                    ),
                )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("lead time of 24 hours", context.exception.detail)
        self.assertEqual(fake_supabase.insert_calls, 0)

    def test_rejects_booking_with_wrong_duration(self):
        now = datetime.now(timezone.utc)
        start = now + timedelta(hours=30)
        fake_supabase = _ValidationSupabase(
            select_results=[
                {
                    "id": "listing-1",
                    "seller_id": "seller-profile-id",
                    "price_cents": 4500,
                    "currency": "USD",
                    "status": "active",
                    "type": "service",
                    "requires_booking": True,
                    "duration_minutes": 90,
                    "lead_time_hours": 2,
                }
            ]
        )

        with patch("app.services.bookings.get_supabase_client", return_value=fake_supabase):
            with self.assertRaises(HTTPException) as context:
                create_booking(
                    BUYER_USER,
                    BookingCreate(
                        seller_id="seller-profile-id",
                        listing_id="listing-1",
                        scheduled_start=start,
                        scheduled_end=start + timedelta(hours=2),
                    ),
                )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("exactly 90 minutes", context.exception.detail)
        self.assertEqual(fake_supabase.insert_calls, 0)


class _ValidationSupabase:
    def __init__(self, *, select_results):
        self._select_results = list(select_results)
        self.insert_calls = 0

    def select(self, *args, **kwargs):
        if not self._select_results:
            raise AssertionError("Unexpected select call")
        return self._select_results.pop(0)

    def insert(self, *args, **kwargs):
        self.insert_calls += 1
        return []


if __name__ == "__main__":
    unittest.main()
