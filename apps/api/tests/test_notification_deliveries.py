from datetime import datetime
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.dependencies.auth import CurrentUser
from app.services.notification_deliveries import (
    get_admin_notification_delivery_summary,
    get_admin_notification_worker_health,
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
    def test_admin_summary_aggregates_queue_health(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                [
                    {
                        "channel": "email",
                        "delivery_status": "failed",
                        "transaction_kind": "order",
                        "created_at": "2026-04-08T11:30:00+00:00",
                    },
                    {
                        "channel": "push",
                        "delivery_status": "queued",
                        "transaction_kind": "booking",
                        "created_at": "2026-04-08T10:00:00+00:00",
                    },
                    {
                        "channel": "email",
                        "delivery_status": "sent",
                        "transaction_kind": "order",
                        "created_at": "2026-04-06T10:00:00+00:00",
                    },
                ],
            ],
            update_result=[],
        )

        with (
            patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase),
            patch("app.services.notification_deliveries.datetime") as mock_datetime,
        ):
            mock_datetime.now.return_value = datetime.fromisoformat("2026-04-08T12:00:00+00:00")
            mock_datetime.fromisoformat.side_effect = lambda value: datetime.fromisoformat(value)

            result = get_admin_notification_delivery_summary()

        self.assertEqual(result.total_deliveries, 3)
        self.assertEqual(result.failed_deliveries, 1)
        self.assertEqual(result.queued_deliveries, 1)
        self.assertEqual(result.sent_deliveries, 1)
        self.assertEqual(result.email_deliveries, 2)
        self.assertEqual(result.push_deliveries, 1)
        self.assertEqual(result.order_deliveries, 2)
        self.assertEqual(result.booking_deliveries, 1)
        self.assertEqual(result.failed_last_24h, 1)
        self.assertEqual(result.queued_older_than_1h, 1)
        self.assertEqual(result.oldest_queued_created_at.isoformat(), "2026-04-08T10:00:00+00:00")
        self.assertEqual(result.latest_failure_created_at.isoformat(), "2026-04-08T11:30:00+00:00")

    def test_admin_worker_health_summarizes_due_and_stuck_work(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                [
                    {
                        "delivery_status": "queued",
                        "created_at": "2026-04-08T09:30:00+00:00",
                        "next_attempt_at": "2026-04-08T09:45:00+00:00",
                        "last_attempt_at": None,
                    },
                    {
                        "delivery_status": "processing",
                        "created_at": "2026-04-08T09:50:00+00:00",
                        "next_attempt_at": "2026-04-08T09:50:00+00:00",
                        "last_attempt_at": "2026-04-08T11:55:00+00:00",
                    },
                    {
                        "delivery_status": "processing",
                        "created_at": "2026-04-08T09:40:00+00:00",
                        "next_attempt_at": "2026-04-08T09:40:00+00:00",
                        "last_attempt_at": "2026-04-08T09:45:00+00:00",
                    },
                    {
                        "delivery_status": "failed",
                        "created_at": "2026-04-08T11:30:00+00:00",
                        "next_attempt_at": "2026-04-08T11:35:00+00:00",
                        "last_attempt_at": "2026-04-08T11:30:00+00:00",
                    },
                ]
            ],
            update_result=[],
        )
        settings = type(
            "Settings",
            (),
            {
                "notification_email_provider": "log",
                "notification_push_provider": "expo",
                "notification_worker_poll_seconds": 30,
                "notification_worker_batch_size": 25,
                "notification_max_attempts": 3,
            },
        )()

        with (
            patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase),
            patch("app.services.notification_deliveries.get_settings", return_value=settings),
            patch("app.services.notification_deliveries.datetime") as mock_datetime,
        ):
            mock_datetime.now.return_value = datetime.fromisoformat("2026-04-08T12:00:00+00:00")
            mock_datetime.fromisoformat.side_effect = lambda value: datetime.fromisoformat(value)

            result = get_admin_notification_worker_health()

        self.assertEqual(result.email_provider, "log")
        self.assertEqual(result.push_provider, "expo")
        self.assertEqual(result.worker_poll_seconds, 30)
        self.assertEqual(result.batch_size, 25)
        self.assertEqual(result.max_attempts, 3)
        self.assertEqual(result.due_queued_deliveries, 1)
        self.assertEqual(result.processing_deliveries, 2)
        self.assertEqual(result.stuck_processing_deliveries, 1)
        self.assertEqual(result.recent_failure_deliveries, 1)
        self.assertEqual(result.oldest_due_queued_created_at.isoformat(), "2026-04-08T09:30:00+00:00")
        self.assertEqual(
            result.oldest_stuck_processing_last_attempt_at.isoformat(),
            "2026-04-08T09:45:00+00:00",
        )

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
