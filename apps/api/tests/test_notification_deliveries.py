import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.services.notification_deliveries import (
    retry_admin_notification_deliveries,
    retry_my_notification_delivery,
)
from app.schemas.notifications import NotificationDeliveryBulkRetryRequest


USER = CurrentUser(
    id="buyer-user-id",
    email="buyer@example.com",
    access_token="buyer-token",
)


class NotificationDeliveryRetryTests(unittest.TestCase):
    def test_retry_requeues_failed_delivery(self):
        failed_delivery = {
            "id": "delivery-1",
            "recipient_user_id": USER.id,
            "transaction_kind": "order",
            "transaction_id": "order-1",
            "event_id": "event-1",
            "channel": "email",
            "delivery_status": "failed",
            "payload": {"subject": "Order update"},
            "failure_reason": "Provider rejected sender",
            "attempts": 2,
            "sent_at": None,
            "created_at": "2026-04-01T12:00:00+00:00",
        }
        updated_delivery = {
            **failed_delivery,
            "delivery_status": "queued",
            "failure_reason": None,
        }
        fake_supabase = _FakeSupabase(
            select_side_effect=[failed_delivery],
            update_result=[updated_delivery],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = retry_my_notification_delivery(USER, "delivery-1")

        self.assertEqual(result.delivery_status, "queued")
        self.assertIsNone(result.failure_reason)

    def test_retry_rejects_sent_delivery(self):
        sent_delivery = {
            "id": "delivery-1",
            "recipient_user_id": USER.id,
            "transaction_kind": "order",
            "transaction_id": "order-1",
            "event_id": "event-1",
            "channel": "email",
            "delivery_status": "sent",
            "payload": {"subject": "Order update"},
            "failure_reason": None,
            "attempts": 1,
            "sent_at": "2026-04-01T12:10:00+00:00",
            "created_at": "2026-04-01T12:00:00+00:00",
        }
        fake_supabase = _FakeSupabase(select_side_effect=[sent_delivery], update_result=[])

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            with self.assertRaises(HTTPException) as context:
                retry_my_notification_delivery(USER, "delivery-1")

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("Only failed or queued", context.exception.detail)

    def test_admin_bulk_retry_requeues_failed_deliveries(self):
        failed_delivery = {
            "id": "delivery-1",
            "recipient_user_id": USER.id,
            "transaction_kind": "order",
            "transaction_id": "order-1",
            "event_id": "event-1",
            "channel": "email",
            "delivery_status": "failed",
            "payload": {"subject": "Order update"},
            "failure_reason": "Provider rejected sender",
            "attempts": 2,
            "sent_at": None,
            "created_at": "2026-04-01T12:00:00+00:00",
        }
        updated_delivery = {
            **failed_delivery,
            "delivery_status": "queued",
            "failure_reason": None,
        }
        fake_supabase = _FakeSupabase(
            select_side_effect=[failed_delivery],
            update_result=[updated_delivery],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = retry_admin_notification_deliveries(
                NotificationDeliveryBulkRetryRequest(delivery_ids=["delivery-1"]),
            )

        self.assertEqual(result.succeeded_ids, ["delivery-1"])
        self.assertEqual(result.failed, [])

    def test_admin_bulk_retry_atomic_preflight_blocks_invalid_delivery(self):
        sent_delivery = {
            "id": "delivery-1",
            "recipient_user_id": USER.id,
            "transaction_kind": "order",
            "transaction_id": "order-1",
            "event_id": "event-1",
            "channel": "email",
            "delivery_status": "sent",
            "payload": {"subject": "Order update"},
            "failure_reason": None,
            "attempts": 1,
            "sent_at": "2026-04-01T12:10:00+00:00",
            "created_at": "2026-04-01T12:00:00+00:00",
        }
        fake_supabase = _FakeSupabase(select_side_effect=[sent_delivery], update_result=[])

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = retry_admin_notification_deliveries(
                NotificationDeliveryBulkRetryRequest(
                    delivery_ids=["delivery-1"],
                    execution_mode="atomic",
                ),
            )

        self.assertEqual(result.succeeded_ids, [])
        self.assertEqual(len(result.failed), 1)
        self.assertEqual(result.failed[0].id, "delivery-1")
        self.assertIn("Only failed or queued", result.failed[0].detail)


class _FakeSupabase:
    def __init__(self, *, select_side_effect, update_result):
        self._select_side_effect = list(select_side_effect)
        self._update_result = update_result

    def select(self, *args, **kwargs):
        if not self._select_side_effect:
            raise AssertionError("Unexpected select call")
        next_item = self._select_side_effect.pop(0)
        if isinstance(next_item, Exception):
            raise next_item
        return next_item

    def update(self, *args, **kwargs):
        return self._update_result


if __name__ == "__main__":
    unittest.main()
