import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.schemas.bookings import BookingStatusUpdate
from app.schemas.orders import OrderStatusUpdate
from app.services.bookings import generate_booking_response_ai_assist, update_booking_status
from app.services.orders import generate_order_response_ai_assist, update_order_status


SELLER_USER = CurrentUser(id="seller-user-id", email="seller@example.com", access_token="seller-token")
BUYER_USER = CurrentUser(id="buyer-user-id", email="buyer@example.com", access_token="buyer-token")


class OrderWorkflowTests(unittest.TestCase):
    def test_seller_can_confirm_pending_order(self):
        current_order = {
            "id": "order-1",
            "buyer_id": BUYER_USER.id,
            "seller_id": "seller-profile-id",
            "status": "pending",
            "fulfillment": "pickup",
            "subtotal_cents": 1800,
            "total_cents": 1800,
            "currency": "USD",
            "notes": None,
            "seller_response_note": None,
            "order_items": [],
        }
        updated_order = {
            **current_order,
            "status": "confirmed",
            "seller_response_note": "Pickup at 5pm.",
            "order_status_events": [
                {
                    "id": "event-1",
                    "status": "confirmed",
                    "actor_role": "seller",
                    "note": "Pickup at 5pm.",
                    "created_at": "2026-03-30T18:00:00+00:00",
                }
            ],
        }

        fake_supabase = _FakeSupabase(
            select_side_effect=[current_order, {"id": "seller-profile-id"}, updated_order],
            update_result=[updated_order],
        )

        with (
            patch("app.services.orders.get_supabase_client", return_value=fake_supabase),
            patch("app.services.orders.queue_transaction_notification_jobs"),
        ):
            result = update_order_status(
                SELLER_USER,
                "order-1",
                OrderStatusUpdate(status="confirmed", seller_response_note="Pickup at 5pm."),
            )

        self.assertEqual(result.status, "confirmed")
        self.assertEqual(result.seller_response_note, "Pickup at 5pm.")
        self.assertEqual(fake_supabase.update_calls, 1)
        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(fake_supabase.insert_payloads[0]["status"], "confirmed")
        self.assertEqual(fake_supabase.insert_payloads[0]["actor_role"], "seller")

    def test_buyer_cannot_skip_order_workflow(self):
        current_order = {
            "id": "order-1",
            "buyer_id": BUYER_USER.id,
            "seller_id": "seller-profile-id",
            "status": "confirmed",
            "fulfillment": "pickup",
            "subtotal_cents": 1800,
            "total_cents": 1800,
            "currency": "USD",
            "notes": None,
            "seller_response_note": None,
            "order_items": [],
        }

        fake_supabase = _FakeSupabase(
            select_side_effect=[
                current_order,
                SupabaseError(406, "Not a seller for this order"),
            ],
        )

        with (
            patch("app.services.orders.get_supabase_client", return_value=fake_supabase),
            patch("app.services.orders.queue_transaction_notification_jobs"),
        ):
            with self.assertRaises(HTTPException) as context:
                update_order_status(
                    BUYER_USER,
                    "order-1",
                    OrderStatusUpdate(status="ready"),
                )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("Invalid order transition for buyer", context.exception.detail)
        self.assertEqual(fake_supabase.update_calls, 0)

    def test_seller_can_generate_order_response_suggestion(self):
        current_order = {
            "id": "order-1",
            "buyer_id": BUYER_USER.id,
            "seller_id": "seller-profile-id",
            "status": "pending",
            "fulfillment": "pickup",
            "subtotal_cents": 1800,
            "total_cents": 1800,
            "currency": "USD",
            "notes": "Can you make sure it is ready after 5pm?",
            "buyer_browse_context": "Quick booking lane",
            "seller_response_note": None,
            "order_items": [],
        }
        fake_supabase = _FakeSupabase(select_side_effect=[current_order])

        with patch("app.services.orders.get_supabase_client", return_value=fake_supabase):
            result = generate_order_response_ai_assist(SELLER_USER, "order-1")

        self.assertEqual(result.transaction_kind, "order")
        self.assertEqual(result.transaction_id, "order-1")
        self.assertIn("order reply", result.suggestion.summary.lower())
        self.assertIn("make sure it is ready after 5pm", result.suggestion.suggested_note.lower())


class BookingWorkflowTests(unittest.TestCase):
    def test_seller_can_confirm_requested_booking(self):
        current_booking = {
            "id": "booking-1",
            "buyer_id": BUYER_USER.id,
            "seller_id": "seller-profile-id",
            "listing_id": "listing-1",
            "status": "requested",
            "scheduled_start": "2026-03-31T15:00:00+00:00",
            "scheduled_end": "2026-03-31T16:30:00+00:00",
            "total_cents": 4500,
            "currency": "USD",
            "notes": None,
            "seller_response_note": None,
            "listings": {"title": "Repair Visit", "type": "service"},
        }
        updated_booking = {
            **current_booking,
            "status": "confirmed",
            "seller_response_note": "Please arrive 10 minutes early.",
            "booking_status_events": [
                {
                    "id": "event-1",
                    "status": "confirmed",
                    "actor_role": "seller",
                    "note": "Please arrive 10 minutes early.",
                    "created_at": "2026-03-30T18:00:00+00:00",
                }
            ],
        }

        fake_supabase = _FakeSupabase(
            select_side_effect=[current_booking, {"id": "seller-profile-id"}, updated_booking],
            update_result=[updated_booking],
        )

        with (
            patch("app.services.bookings.get_supabase_client", return_value=fake_supabase),
            patch("app.services.bookings.queue_transaction_notification_jobs"),
        ):
            result = update_booking_status(
                SELLER_USER,
                "booking-1",
                BookingStatusUpdate(status="confirmed", seller_response_note="Please arrive 10 minutes early."),
            )

        self.assertEqual(result.status, "confirmed")
        self.assertEqual(result.seller_response_note, "Please arrive 10 minutes early.")
        self.assertEqual(fake_supabase.update_calls, 1)
        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(fake_supabase.insert_payloads[0]["status"], "confirmed")
        self.assertEqual(fake_supabase.insert_payloads[0]["actor_role"], "seller")

    def test_buyer_cannot_complete_confirmed_booking(self):
        current_booking = {
            "id": "booking-1",
            "buyer_id": BUYER_USER.id,
            "seller_id": "seller-profile-id",
            "listing_id": "listing-1",
            "status": "confirmed",
            "scheduled_start": "2026-03-31T15:00:00+00:00",
            "scheduled_end": "2026-03-31T16:30:00+00:00",
            "total_cents": 4500,
            "currency": "USD",
            "notes": None,
            "seller_response_note": None,
            "listings": {"title": "Repair Visit", "type": "service"},
        }

        fake_supabase = _FakeSupabase(
            select_side_effect=[
                current_booking,
                SupabaseError(406, "Not a seller for this booking"),
            ],
        )

        with (
            patch("app.services.bookings.get_supabase_client", return_value=fake_supabase),
            patch("app.services.bookings.queue_transaction_notification_jobs"),
        ):
            with self.assertRaises(HTTPException) as context:
                update_booking_status(
                    BUYER_USER,
                    "booking-1",
                    BookingStatusUpdate(status="completed"),
                )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("Invalid booking transition for buyer", context.exception.detail)
        self.assertEqual(fake_supabase.update_calls, 0)

    def test_seller_can_generate_booking_response_suggestion(self):
        current_booking = {
            "id": "booking-1",
            "buyer_id": BUYER_USER.id,
            "seller_id": "seller-profile-id",
            "listing_id": "listing-1",
            "status": "requested",
            "scheduled_start": "2026-03-31T15:00:00+00:00",
            "scheduled_end": "2026-03-31T16:30:00+00:00",
            "total_cents": 4500,
            "currency": "USD",
            "notes": "Please confirm if Tuesday works.",
            "buyer_browse_context": "Services lane",
            "seller_response_note": None,
            "listings": {"title": "Repair Visit", "type": "service"},
        }
        fake_supabase = _FakeSupabase(select_side_effect=[current_booking])

        with patch("app.services.bookings.get_supabase_client", return_value=fake_supabase):
            result = generate_booking_response_ai_assist(SELLER_USER, "booking-1")

        self.assertEqual(result.transaction_kind, "booking")
        self.assertEqual(result.transaction_id, "booking-1")
        self.assertIn("booking reply", result.suggestion.summary.lower())
        self.assertIn("tuesday works", result.suggestion.suggested_note.lower())


class _FakeSupabase:
    def __init__(self, *, select_side_effect, update_result=None):
        self._select_side_effect = list(select_side_effect)
        self._update_result = update_result or []
        self.update_calls = 0
        self.insert_calls = 0
        self.insert_payloads = []

    def select(self, *args, **kwargs):
        if not self._select_side_effect:
            raise AssertionError("Unexpected select call")

        next_item = self._select_side_effect.pop(0)
        if isinstance(next_item, Exception):
            raise next_item
        return next_item

    def update(self, *args, **kwargs):
        self.update_calls += 1
        return self._update_result

    def insert(self, table, payload, **kwargs):
        self.insert_calls += 1
        self.insert_payloads.append(payload)
        if isinstance(payload, dict):
            return [{**payload, "id": payload.get("id", f"{table}-event-1")}]
        return payload


if __name__ == "__main__":
    unittest.main()
