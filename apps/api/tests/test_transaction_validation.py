from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.dependencies.auth import CurrentUser
from app.schemas.bookings import BookingCreate
from app.schemas.orders import OrderCreate, OrderItemCreate, OrderStatusUpdate
from app.services.bookings import create_booking
from app.services.orders import create_order, update_order_status


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


class OrderStatusValidationTests(unittest.TestCase):
    def test_seller_cancellation_after_acceptance_queues_order_exception_alert(self):
        current_user = CurrentUser(
            id="seller-user-id",
            email="seller@example.com",
            access_token="seller-token",
        )
        current_order = {
            "id": "order-1",
            "buyer_id": "buyer-user-id",
            "seller_id": "seller-profile-id",
            "status": "confirmed",
            "fulfillment": "pickup",
            "subtotal_cents": 2500,
            "total_cents": 2500,
            "currency": "USD",
            "delivery_fee_cents": 0,
            "platform_fee_cents": 0,
            "platform_fee_rate": "0",
            "notes": "Need by Friday",
            "buyer_browse_context": "catalog:featured",
            "seller_response_note": None,
            "order_items": [
                {
                    "id": "item-1",
                    "listing_id": "listing-1",
                    "quantity": 1,
                    "unit_price_cents": 2500,
                    "total_price_cents": 2500,
                    "listings": {
                        "title": "Tamales Box",
                        "type": "product",
                        "is_local_only": True,
                    },
                }
            ],
            "order_status_events": [
                {
                    "id": "event-1",
                    "status": "confirmed",
                    "actor_role": "buyer",
                    "note": "Need by Friday",
                    "created_at": "2026-04-07T15:00:00+00:00",
                }
            ],
        }
        updated_order = {
            **current_order,
            "status": "canceled",
            "order_status_events": [
                *current_order["order_status_events"],
                {
                    "id": "event-2",
                    "status": "canceled",
                    "actor_role": "seller",
                    "note": "Seller could not fulfill the order.",
                    "created_at": "2026-04-07T16:00:00+00:00",
                },
            ],
        }
        fake_supabase = _ValidationSupabase(
            select_results=[
                current_order,
                {"id": "seller-profile-id", "user_id": "seller-user-id"},
                {
                    "id": "seller-profile-id",
                    "slug": "tamales-by-lupe",
                    "display_name": "Tamales by Lupe",
                    "user_id": "seller-user-id",
                },
                {
                    "id": "buyer-user-id",
                    "display_name": "Buyer One",
                },
                [
                    {
                        "id": "seller-user-id",
                        "email_notifications_enabled": True,
                        "push_notifications_enabled": True,
                    },
                    {
                        "id": "admin-support-id",
                        "email_notifications_enabled": True,
                        "push_notifications_enabled": True,
                    },
                    {
                        "id": "admin-owner-id",
                        "email_notifications_enabled": True,
                        "push_notifications_enabled": True,
                    },
                ],
                [],
                updated_order,
            ],
            insert_results=[[{"id": "event-2"}], [{"id": "delivery-1"}, {"id": "delivery-2"}]],
            update_results=[[updated_order]],
        )

        settings = type(
            "Settings",
            (),
            {
                "admin_user_ids": ["admin-support-id", "admin-owner-id"],
                "admin_user_roles": {
                    "admin-support-id": "support",
                    "admin-owner-id": "owner",
                },
            },
        )()

        with (
            patch("app.services.orders.get_supabase_client", return_value=fake_supabase),
            patch("app.services.orders.get_settings", return_value=settings),
            patch("app.services.orders.queue_transaction_notification_jobs") as mock_queue,
            patch("app.services.orders.process_notification_delivery_rows"),
        ):
            result = update_order_status(
                current_user,
                "order-1",
                OrderStatusUpdate(status="canceled", seller_response_note="Seller could not fulfill the order."),
            )

        self.assertEqual(result.status, "canceled")
        self.assertEqual(fake_supabase.insert_calls, 2)
        self.assertEqual(fake_supabase.update_calls, 1)
        self.assertEqual(mock_queue.call_count, 1)
        self.assertEqual(fake_supabase.insert_payloads[1][0]["payload"]["alert_type"], "order_exception")
        self.assertEqual(
            {delivery["recipient_user_id"] for delivery in fake_supabase.insert_payloads[1]},
            {"seller-user-id", "admin-support-id", "admin-owner-id"},
        )

    def test_buyer_cancellation_after_acceptance_queues_order_fraud_watch_alert(self):
        current_user = BUYER_USER
        current_order = {
            "id": "order-1",
            "buyer_id": "buyer-user-id",
            "seller_id": "seller-profile-id",
            "status": "confirmed",
            "fulfillment": "pickup",
            "subtotal_cents": 2500,
            "total_cents": 2500,
            "currency": "USD",
            "delivery_fee_cents": 0,
            "platform_fee_cents": 0,
            "platform_fee_rate": "0",
            "notes": "Need by Friday",
            "buyer_browse_context": "catalog:featured",
            "seller_response_note": None,
            "order_items": [
                {
                    "id": "item-1",
                    "listing_id": "listing-1",
                    "quantity": 1,
                    "unit_price_cents": 2500,
                    "total_price_cents": 2500,
                    "listings": {
                        "title": "Tamales Box",
                        "type": "product",
                        "is_local_only": True,
                    },
                }
            ],
            "order_status_events": [
                {
                    "id": "event-1",
                    "status": "confirmed",
                    "actor_role": "buyer",
                    "note": "Need by Friday",
                    "created_at": "2026-04-07T15:00:00+00:00",
                }
            ],
        }
        updated_order = {
            **current_order,
            "status": "canceled",
            "order_status_events": [
                *current_order["order_status_events"],
                {
                    "id": "event-2",
                    "status": "canceled",
                    "actor_role": "buyer",
                    "note": "Changed my mind.",
                    "created_at": "2026-04-07T16:00:00+00:00",
                },
            ],
        }
        fake_supabase = _ValidationSupabase(
            select_results=[
                current_order,
                {
                    "id": "seller-profile-id",
                    "slug": "tamales-by-lupe",
                    "display_name": "Tamales by Lupe",
                    "user_id": "seller-user-id",
                },
                {
                    "id": "buyer-user-id",
                    "display_name": "Buyer One",
                },
                [
                    {
                        "id": "admin-support-id",
                        "email_notifications_enabled": True,
                        "push_notifications_enabled": True,
                    }
                ],
                [],
                updated_order,
            ],
            insert_results=[[{"id": "event-2"}], [{"id": "delivery-1"}, {"id": "delivery-2"}]],
            update_results=[[updated_order]],
        )

        settings = type(
            "Settings",
            (),
            {
                "admin_user_ids": ["admin-support-id"],
                "admin_user_roles": {
                    "admin-support-id": "support",
                },
            },
        )()

        with (
            patch("app.services.orders.get_supabase_client", return_value=fake_supabase),
            patch("app.services.orders.get_settings", return_value=settings),
            patch("app.services.orders._resolve_order_actor", return_value="buyer"),
            patch("app.services.orders.queue_transaction_notification_jobs") as mock_queue,
            patch("app.services.orders.queue_order_fraud_watch_notifications") as mock_fraud_queue,
            patch("app.services.orders.process_notification_delivery_rows"),
        ):
            result = update_order_status(
                current_user,
                "order-1",
                OrderStatusUpdate(status="canceled", seller_response_note="Changed my mind."),
            )

        self.assertEqual(result.status, "canceled")
        self.assertEqual(fake_supabase.insert_calls, 2)
        self.assertEqual(fake_supabase.update_calls, 1)
        self.assertEqual(mock_queue.call_count, 1)
        self.assertEqual(mock_fraud_queue.call_count, 1)
        self.assertEqual(fake_supabase.insert_payloads[1][0]["payload"]["alert_type"], "order_exception")
        self.assertEqual(
            {delivery["recipient_user_id"] for delivery in fake_supabase.insert_payloads[1]},
            {"admin-support-id"},
        )


class BookingCreationValidationTests(unittest.TestCase):
    def test_auto_accept_booking_confirms_request_immediately(self):
        now = datetime.now(timezone.utc)
        current_booking = {
            "id": "booking-1",
            "buyer_id": BUYER_USER.id,
            "seller_id": "seller-profile-id",
            "listing_id": "listing-1",
            "status": "confirmed",
            "scheduled_start": (now + timedelta(hours=30)).isoformat(),
            "scheduled_end": (now + timedelta(hours=31, minutes=30)).isoformat(),
            "total_cents": 4500,
            "currency": "USD",
            "notes": "Please confirm if Tuesday works.",
            "seller_response_note": None,
            "listings": {
                "title": "Service Visit",
                "type": "service",
                "is_local_only": True,
                "auto_accept_bookings": True,
            },
            "booking_status_events": [
                {
                    "id": "event-1",
                    "status": "confirmed",
                    "actor_role": "system",
                    "note": "Auto-confirmed by listing settings.",
                    "created_at": "2026-04-07T15:00:00+00:00",
                }
            ],
        }
        fake_supabase = _ValidationSupabase(
            select_results=[
                {
                    "id": "listing-1",
                    "seller_id": "seller-profile-id",
                    "title": "Service Visit",
                    "price_cents": 4500,
                    "currency": "USD",
                    "status": "active",
                    "type": "service",
                    "requires_booking": True,
                    "duration_minutes": 90,
                    "lead_time_hours": 2,
                    "auto_accept_bookings": True,
                },
                [],
                {"user_id": "seller-user-id"},
                current_booking,
            ],
            insert_results=[[current_booking], [{"id": "event-1"}]],
        )

        with (
            patch("app.services.bookings.get_supabase_client", return_value=fake_supabase),
            patch("app.services.bookings.queue_transaction_notification_jobs") as mock_queue,
        ):
            result = create_booking(
                BUYER_USER,
                BookingCreate(
                    seller_id="seller-profile-id",
                    listing_id="listing-1",
                    scheduled_start=now + timedelta(hours=30),
                    scheduled_end=now + timedelta(hours=31, minutes=30),
                    notes="Please confirm if Tuesday works.",
                ),
            )

        self.assertEqual(result.status, "confirmed")
        self.assertEqual(fake_supabase.insert_calls, 2)
        self.assertEqual(fake_supabase.insert_payloads[0]["status"], "confirmed")
        self.assertEqual(fake_supabase.insert_payloads[1]["status"], "confirmed")
        self.assertEqual(fake_supabase.insert_payloads[1]["actor_role"], "system")
        self.assertEqual(mock_queue.call_count, 2)

    def test_auto_accept_booking_conflict_stays_requested_and_alerts_seller(self):
        now = datetime.now(timezone.utc)
        current_booking = {
            "id": "booking-1",
            "buyer_id": BUYER_USER.id,
            "seller_id": "seller-profile-id",
            "listing_id": "listing-1",
            "status": "requested",
            "scheduled_start": (now + timedelta(hours=30)).isoformat(),
            "scheduled_end": (now + timedelta(hours=31, minutes=30)).isoformat(),
            "total_cents": 4500,
            "currency": "USD",
            "notes": "Please confirm if Tuesday works.",
            "seller_response_note": None,
            "listings": {
                "title": "Service Visit",
                "type": "service",
                "is_local_only": True,
                "auto_accept_bookings": True,
            },
            "booking_status_events": [
                {
                    "id": "event-1",
                    "status": "requested",
                    "actor_role": "buyer",
                    "note": "Please confirm if Tuesday works.",
                    "created_at": "2026-04-07T15:00:00+00:00",
                }
            ],
        }
        fake_supabase = _ValidationSupabase(
            select_results=[
                {
                    "id": "listing-1",
                    "seller_id": "seller-profile-id",
                    "title": "Service Visit",
                    "price_cents": 4500,
                    "currency": "USD",
                    "status": "active",
                    "type": "service",
                    "requires_booking": True,
                    "duration_minutes": 90,
                    "lead_time_hours": 2,
                    "auto_accept_bookings": True,
                },
                [
                    {
                        "id": "booking-conflict-1",
                        "status": "confirmed",
                        "scheduled_start": (now + timedelta(hours=30, minutes=15)).isoformat(),
                        "scheduled_end": (now + timedelta(hours=31, minutes=45)).isoformat(),
                    }
                ],
                {
                    "id": "seller-profile-id",
                    "slug": "service-seller",
                    "display_name": "Service Seller",
                    "user_id": "seller-user-id",
                },
                [],
                current_booking,
            ],
            insert_results=[
                [current_booking],
                [{"id": "event-1"}],
                [{"id": "delivery-1"}, {"id": "delivery-2"}],
            ],
        )

        with (
            patch("app.services.bookings.get_supabase_client", return_value=fake_supabase),
            patch("app.services.bookings.queue_transaction_notification_jobs") as mock_queue,
            patch("app.services.bookings.process_notification_delivery_rows"),
        ):
            result = create_booking(
                BUYER_USER,
                BookingCreate(
                    seller_id="seller-profile-id",
                    listing_id="listing-1",
                    scheduled_start=now + timedelta(hours=30),
                    scheduled_end=now + timedelta(hours=31, minutes=30),
                    notes="Please confirm if Tuesday works.",
                ),
            )

        self.assertEqual(result.status, "requested")
        self.assertEqual(fake_supabase.insert_calls, 3)
        self.assertEqual(fake_supabase.insert_payloads[0]["status"], "requested")
        self.assertEqual(fake_supabase.insert_payloads[1]["status"], "requested")
        self.assertEqual(fake_supabase.insert_payloads[1]["actor_role"], "buyer")
        self.assertEqual(fake_supabase.insert_payloads[2][0]["payload"]["alert_type"], "booking_conflict")
        self.assertEqual(mock_queue.call_count, 1)

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
    def __init__(self, *, select_results, insert_results=None, update_results=None):
        self._select_results = list(select_results)
        self._insert_results = list(insert_results or [])
        self._update_results = list(update_results or [])
        self.insert_calls = 0
        self.update_calls = 0
        self.insert_payloads = []
        self.update_payloads = []

    def select(self, *args, **kwargs):
        if not self._select_results:
            raise AssertionError("Unexpected select call")
        return self._select_results.pop(0)

    def insert(self, *args, **kwargs):
        self.insert_calls += 1
        payload = args[1] if len(args) > 1 else kwargs.get("values")
        self.insert_payloads.append(payload)
        if self._insert_results:
            return self._insert_results.pop(0)
        return []

    def update(self, *args, **kwargs):
        self.update_calls += 1
        payload = args[1] if len(args) > 1 else kwargs.get("values")
        self.update_payloads.append(payload)
        if self._update_results:
            return self._update_results.pop(0)
        return []


if __name__ == "__main__":
    unittest.main()
