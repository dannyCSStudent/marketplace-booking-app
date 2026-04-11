from datetime import datetime
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.dependencies.auth import CurrentUser
from app.services.notification_deliveries import (
    acknowledge_admin_booking_conflict,
    acknowledge_admin_delivery_failure,
    acknowledge_admin_inventory_alert,
    acknowledge_admin_trust_alert,
    acknowledge_admin_order_exception,
    acknowledge_admin_subscription_downgrade,
    clear_admin_booking_conflict_acknowledgement,
    clear_admin_delivery_failure_acknowledgement,
    clear_admin_inventory_alert_acknowledgement,
    clear_admin_trust_alert_acknowledgement,
    clear_admin_order_exception_acknowledgement,
    clear_admin_subscription_downgrade_acknowledgement,
    get_admin_notification_delivery_summary,
    get_admin_notification_worker_health,
    list_admin_delivery_failure_events,
    list_admin_delivery_failure_summaries,
    list_admin_inventory_alert_events,
    list_admin_inventory_alert_summaries,
    list_admin_booking_conflict_events,
    list_admin_booking_conflict_seller_summaries,
    list_admin_order_exception_events,
    list_admin_order_exception_seller_summaries,
    list_admin_subscription_downgrade_events,
    list_admin_subscription_downgrade_seller_summaries,
    list_admin_trust_alert_seller_summaries,
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

    def test_admin_can_acknowledge_trust_alert_deliveries(self):
        delivery = {
            "id": "delivery-1",
            "recipient_user_id": "trust-admin",
            "transaction_kind": "seller",
            "transaction_id": "seller-1",
            "event_id": "seller-trust-intervention:seller-1:critical:worsening",
            "channel": "email",
            "delivery_status": "sent",
            "payload": {
                "alert_type": "seller_trust_intervention",
                "seller_id": "seller-1",
                "alert_signature": "seller-1|critical|worsening|high|Trend|Reason|Hidden reviews are present",
            },
            "failure_reason": None,
            "attempts": 1,
            "sent_at": "2026-04-08T11:00:00+00:00",
            "created_at": "2026-04-08T11:00:00+00:00",
        }
        updated_delivery = {
            **delivery,
            "payload": {
                **delivery["payload"],
                "acknowledged_at": "2026-04-08T12:00:00+00:00",
                "acknowledged_by_user_id": "admin-user-id",
                "acknowledged_signature": delivery["payload"]["alert_signature"],
            },
        }
        fake_supabase = _FakeSupabase(select_side_effect=[[delivery]], update_result=[updated_delivery])

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = acknowledge_admin_trust_alert("seller-1", actor_user_id="admin-user-id")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].payload["acknowledged_by_user_id"], "admin-user-id")
        self.assertEqual(result[0].payload["acknowledged_signature"], delivery["payload"]["alert_signature"])

    def test_admin_can_clear_trust_alert_acknowledgement(self):
        delivery = {
            "id": "delivery-1",
            "recipient_user_id": "trust-admin",
            "transaction_kind": "seller",
            "transaction_id": "seller-1",
            "event_id": "seller-trust-intervention:seller-1:critical:worsening",
            "channel": "email",
            "delivery_status": "sent",
            "payload": {
                "alert_type": "seller_trust_intervention",
                "seller_id": "seller-1",
                "alert_signature": "seller-1|critical|worsening|high|Trend|Reason|Hidden reviews are present",
                "acknowledged_at": "2026-04-08T12:00:00+00:00",
                "acknowledged_by_user_id": "admin-user-id",
                "acknowledged_signature": "seller-1|critical|worsening|high|Trend|Reason|Hidden reviews are present",
            },
            "failure_reason": None,
            "attempts": 1,
            "sent_at": "2026-04-08T11:00:00+00:00",
            "created_at": "2026-04-08T11:00:00+00:00",
        }
        updated_delivery = {
            **delivery,
            "payload": {
                "alert_type": "seller_trust_intervention",
                "seller_id": "seller-1",
                "alert_signature": delivery["payload"]["alert_signature"],
            },
        }
        fake_supabase = _FakeSupabase(select_side_effect=[[delivery]], update_result=[updated_delivery])

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = clear_admin_trust_alert_acknowledgement("seller-1")

        self.assertEqual(len(result), 1)
        self.assertNotIn("acknowledged_at", result[0].payload)
        self.assertNotIn("acknowledged_signature", result[0].payload)

    def test_admin_can_group_trust_alert_seller_summaries(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                [
                    {
                        "seller_id": "seller-1",
                        "seller_slug": "seller-one",
                        "seller_display_name": "Seller One",
                        "action": "acknowledged",
                        "risk_level": "critical",
                        "trend_direction": "worsening",
                        "created_at": "2026-04-08T12:00:00+00:00",
                    },
                    {
                        "seller_id": "seller-1",
                        "seller_slug": "seller-one",
                        "seller_display_name": "Seller One",
                        "action": "cleared",
                        "risk_level": "critical",
                        "trend_direction": "worsening",
                        "created_at": "2026-04-08T11:00:00+00:00",
                    },
                    {
                        "seller_id": "seller-2",
                        "seller_slug": "seller-two",
                        "seller_display_name": "Seller Two",
                        "action": "acknowledged",
                        "risk_level": "elevated",
                        "trend_direction": "steady",
                        "created_at": "2026-04-08T10:00:00+00:00",
                    },
                ],
            ],
            update_result=[],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = list_admin_trust_alert_seller_summaries(limit=2)

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].seller_id, "seller-1")
        self.assertEqual(result[0].event_count, 2)
        self.assertEqual(result[0].latest_event_action, "acknowledged")
        self.assertEqual(result[0].latest_event_risk_level, "critical")
        self.assertEqual(result[1].seller_id, "seller-2")
        self.assertEqual(result[1].event_count, 1)

    def test_admin_can_filter_trust_alert_seller_summaries_by_action(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                [
                    {
                        "seller_id": "seller-1",
                        "seller_slug": "seller-one",
                        "seller_display_name": "Seller One",
                        "action": "acknowledged",
                        "risk_level": "critical",
                        "trend_direction": "worsening",
                        "created_at": "2026-04-08T12:00:00+00:00",
                    },
                    {
                        "seller_id": "seller-2",
                        "seller_slug": "seller-two",
                        "seller_display_name": "Seller Two",
                        "action": "cleared",
                        "risk_level": "elevated",
                        "trend_direction": "steady",
                        "created_at": "2026-04-08T10:00:00+00:00",
                    },
                ],
            ],
            update_result=[],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = list_admin_trust_alert_seller_summaries(limit=8, action="acknowledged")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].seller_id, "seller-1")

    def test_admin_can_acknowledge_order_exception_deliveries(self):
        delivery = {
            "id": "delivery-1",
            "recipient_user_id": "support-admin",
            "transaction_kind": "order",
            "transaction_id": "order-1",
            "event_id": "order-exception:order-1",
            "channel": "email",
            "delivery_status": "sent",
            "payload": {
                "alert_type": "order_exception",
                "seller_id": "seller-1",
                "seller_slug": "seller-one",
                "seller_display_name": "Seller One",
                "order_id": "order-1",
                "current_status": "canceled",
                "alert_signature": "order-1|canceled|seller",
            },
            "failure_reason": None,
            "attempts": 1,
            "sent_at": "2026-04-08T11:00:00+00:00",
            "created_at": "2026-04-08T11:00:00+00:00",
        }
        updated_delivery = {
            **delivery,
            "payload": {
                **delivery["payload"],
                "acknowledged_at": "2026-04-08T12:00:00+00:00",
                "acknowledged_by_user_id": "admin-user-id",
                "acknowledged_signature": delivery["payload"]["alert_signature"],
            },
        }

        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[[delivery]],
            update_result=[updated_delivery],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = acknowledge_admin_order_exception("seller-1", actor_user_id="admin-user-id")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].payload["acknowledged_by_user_id"], "admin-user-id")
        self.assertEqual(result[0].payload["acknowledged_signature"], delivery["payload"]["alert_signature"])
        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(fake_supabase.insert_payloads[0][0]["action"], "acknowledged")

    def test_admin_can_clear_order_exception_acknowledgement(self):
        delivery = {
            "id": "delivery-1",
            "recipient_user_id": "support-admin",
            "transaction_kind": "order",
            "transaction_id": "order-1",
            "event_id": "order-exception:order-1",
            "channel": "email",
            "delivery_status": "sent",
            "payload": {
                "alert_type": "order_exception",
                "seller_id": "seller-1",
                "seller_slug": "seller-one",
                "seller_display_name": "Seller One",
                "order_id": "order-1",
                "current_status": "canceled",
                "alert_signature": "order-1|canceled|seller",
                "acknowledged_at": "2026-04-08T12:00:00+00:00",
                "acknowledged_by_user_id": "admin-user-id",
                "acknowledged_signature": "order-1|canceled|seller",
            },
            "failure_reason": None,
            "attempts": 1,
            "sent_at": "2026-04-08T11:00:00+00:00",
            "created_at": "2026-04-08T11:00:00+00:00",
        }
        updated_delivery = {
            **delivery,
            "payload": {
                "alert_type": "order_exception",
                "seller_id": "seller-1",
                "seller_slug": "seller-one",
                "seller_display_name": "Seller One",
                "order_id": "order-1",
                "current_status": "canceled",
                "alert_signature": delivery["payload"]["alert_signature"],
            },
        }

        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[[delivery]],
            update_result=[updated_delivery],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = clear_admin_order_exception_acknowledgement("seller-1", actor_user_id="admin-user-id")

        self.assertEqual(len(result), 1)
        self.assertNotIn("acknowledged_at", result[0].payload)
        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(fake_supabase.insert_payloads[0][0]["action"], "cleared")

    def test_admin_can_group_order_exception_seller_summaries(self):
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[
                [
                    {
                        "seller_id": "seller-1",
                        "seller_slug": "seller-one",
                        "seller_display_name": "Seller One",
                        "action": "acknowledged",
                        "order_status": "canceled",
                        "created_at": "2026-04-08T12:00:00+00:00",
                    },
                    {
                        "seller_id": "seller-1",
                        "seller_slug": "seller-one",
                        "seller_display_name": "Seller One",
                        "action": "cleared",
                        "order_status": "canceled",
                        "created_at": "2026-04-08T11:00:00+00:00",
                    },
                    {
                        "seller_id": "seller-2",
                        "seller_slug": "seller-two",
                        "seller_display_name": "Seller Two",
                        "action": "acknowledged",
                        "order_status": "canceled",
                        "created_at": "2026-04-08T10:00:00+00:00",
                    },
                ],
            ],
            update_result=[],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = list_admin_order_exception_seller_summaries(limit=2)

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].seller_id, "seller-1")
        self.assertEqual(result[0].event_count, 2)
        self.assertEqual(result[0].latest_event_status, "canceled")

    def test_admin_can_filter_order_exception_seller_summaries_by_action(self):
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[
                [
                    {
                        "seller_id": "seller-1",
                        "seller_slug": "seller-one",
                        "seller_display_name": "Seller One",
                        "action": "acknowledged",
                        "order_status": "canceled",
                        "created_at": "2026-04-08T12:00:00+00:00",
                    },
                    {
                        "seller_id": "seller-2",
                        "seller_slug": "seller-two",
                        "seller_display_name": "Seller Two",
                        "action": "cleared",
                        "order_status": "canceled",
                        "created_at": "2026-04-08T11:00:00+00:00",
                    },
                ],
            ],
            update_result=[],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = list_admin_order_exception_seller_summaries(limit=8, action="acknowledged")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].seller_id, "seller-1")

    def test_admin_can_list_order_exception_events(self):
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[
                [
                    {
                        "id": "event-1",
                        "seller_id": "seller-1",
                        "seller_slug": "seller-one",
                        "seller_display_name": "Seller One",
                        "delivery_id": "delivery-1",
                        "actor_user_id": "admin-user-id",
                        "action": "acknowledged",
                        "alert_signature": "order-1|canceled|seller",
                        "order_id": "order-1",
                        "order_status": "canceled",
                        "created_at": "2026-04-08T12:00:00+00:00",
                    }
                ]
            ],
            update_result=[],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = list_admin_order_exception_events(limit=10)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].action, "acknowledged")

    def test_admin_can_acknowledge_booking_conflict_deliveries(self):
        delivery = {
            "id": "delivery-1",
            "recipient_user_id": "support-admin",
            "transaction_kind": "booking",
            "transaction_id": "booking-1",
            "event_id": "booking-conflict:listing-1:booking-1",
            "channel": "email",
            "delivery_status": "sent",
            "payload": {
                "alert_type": "booking_conflict",
                "seller_id": "seller-1",
                "seller_slug": "seller-one",
                "seller_display_name": "Seller One",
                "booking_id": "booking-1",
                "listing_id": "listing-1",
                "conflict_count": 2,
                "scheduled_start": "2026-04-08T12:00:00+00:00",
                "scheduled_end": "2026-04-08T13:00:00+00:00",
                "alert_signature": "booking-conflict:listing-1:booking-1",
            },
            "failure_reason": None,
            "attempts": 1,
            "sent_at": "2026-04-08T11:00:00+00:00",
            "created_at": "2026-04-08T11:00:00+00:00",
        }
        updated_delivery = {
            **delivery,
            "payload": {
                **delivery["payload"],
                "acknowledged_at": "2026-04-08T12:00:00+00:00",
                "acknowledged_by_user_id": "admin-user-id",
                "acknowledged_signature": delivery["payload"]["alert_signature"],
            },
        }
        fake_supabase = _FakeNotificationSupabase(select_side_effect=[[delivery]], update_result=[updated_delivery])

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = acknowledge_admin_booking_conflict("seller-1", actor_user_id="admin-user-id")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].payload["acknowledged_by_user_id"], "admin-user-id")
        self.assertEqual(fake_supabase.insert_calls, 1)

    def test_admin_can_clear_booking_conflict_acknowledgement(self):
        delivery = {
            "id": "delivery-1",
            "recipient_user_id": "support-admin",
            "transaction_kind": "booking",
            "transaction_id": "booking-1",
            "event_id": "booking-conflict:listing-1:booking-1",
            "channel": "email",
            "delivery_status": "sent",
            "payload": {
                "alert_type": "booking_conflict",
                "seller_id": "seller-1",
                "seller_slug": "seller-one",
                "seller_display_name": "Seller One",
                "booking_id": "booking-1",
                "listing_id": "listing-1",
                "conflict_count": 2,
                "scheduled_start": "2026-04-08T12:00:00+00:00",
                "scheduled_end": "2026-04-08T13:00:00+00:00",
                "alert_signature": "booking-conflict:listing-1:booking-1",
                "acknowledged_at": "2026-04-08T12:00:00+00:00",
                "acknowledged_by_user_id": "admin-user-id",
                "acknowledged_signature": "booking-conflict:listing-1:booking-1",
            },
            "failure_reason": None,
            "attempts": 1,
            "sent_at": "2026-04-08T11:00:00+00:00",
            "created_at": "2026-04-08T11:00:00+00:00",
        }
        updated_delivery = {
            **delivery,
            "payload": {
                "alert_type": "booking_conflict",
                "seller_id": "seller-1",
                "seller_slug": "seller-one",
                "seller_display_name": "Seller One",
                "booking_id": "booking-1",
                "listing_id": "listing-1",
                "conflict_count": 2,
                "scheduled_start": "2026-04-08T12:00:00+00:00",
                "scheduled_end": "2026-04-08T13:00:00+00:00",
                "alert_signature": delivery["payload"]["alert_signature"],
            },
        }
        fake_supabase = _FakeNotificationSupabase(select_side_effect=[[delivery]], update_result=[updated_delivery])

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = clear_admin_booking_conflict_acknowledgement("seller-1", actor_user_id="admin-user-id")

        self.assertEqual(len(result), 1)
        self.assertNotIn("acknowledged_at", result[0].payload)
        self.assertEqual(fake_supabase.insert_calls, 1)

    def test_admin_can_group_booking_conflict_seller_summaries(self):
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[
                [
                    {
                        "seller_id": "seller-1",
                        "seller_slug": "seller-one",
                        "seller_display_name": "Seller One",
                        "action": "acknowledged",
                        "order_status": "conflict",
                        "created_at": "2026-04-08T12:00:00+00:00",
                    },
                    {
                        "seller_id": "seller-1",
                        "seller_slug": "seller-one",
                        "seller_display_name": "Seller One",
                        "action": "cleared",
                        "order_status": "conflict",
                        "created_at": "2026-04-08T11:00:00+00:00",
                    },
                    {
                        "seller_id": "seller-2",
                        "seller_slug": "seller-two",
                        "seller_display_name": "Seller Two",
                        "action": "acknowledged",
                        "order_status": "conflict",
                        "created_at": "2026-04-08T10:00:00+00:00",
                    },
                ],
            ],
            update_result=[],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = list_admin_booking_conflict_seller_summaries(limit=2)

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].seller_id, "seller-1")
        self.assertEqual(result[0].event_count, 2)

    def test_admin_can_list_booking_conflict_events(self):
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[
                [
                    {
                        "id": "event-1",
                        "seller_id": "seller-1",
                        "seller_slug": "seller-one",
                        "seller_display_name": "Seller One",
                        "delivery_id": "delivery-1",
                        "actor_user_id": "admin-user-id",
                        "action": "acknowledged",
                        "alert_signature": "booking-conflict:listing-1:booking-1",
                        "booking_id": "booking-1",
                        "listing_id": "listing-1",
                        "conflict_count": 2,
                        "scheduled_start": "2026-04-08T12:00:00+00:00",
                        "scheduled_end": "2026-04-08T13:00:00+00:00",
                        "created_at": "2026-04-08T12:00:00+00:00",
                    }
                ]
            ],
            update_result=[],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = list_admin_booking_conflict_events(limit=10)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].action, "acknowledged")

    def test_admin_can_acknowledge_delivery_failure_alerts(self):
        delivery = {
            "id": "delivery-1",
            "recipient_user_id": "admin-user-id",
            "transaction_kind": "order",
            "transaction_id": "order-1",
            "event_id": "delivery-failure:order-1",
            "channel": "email",
            "delivery_status": "sent",
            "payload": {
                "alert_type": "delivery_failure",
                "failed_delivery_id": "failed-1",
                "failed_delivery_channel": "email",
                "failed_delivery_status": "failed",
                "failed_delivery_attempts": 3,
                "failed_delivery_reason": "Provider timeout",
                "original_recipient_user_id": "buyer-1",
                "alert_signature": "delivery-failure:delivery-1",
            },
            "failure_reason": None,
            "attempts": 1,
            "sent_at": "2026-04-08T11:00:00+00:00",
            "created_at": "2026-04-08T11:00:00+00:00",
        }
        updated_delivery = {
            **delivery,
            "payload": {
                **delivery["payload"],
                "acknowledged_at": "2026-04-08T12:00:00+00:00",
                "acknowledged_by_user_id": "admin-user-id",
                "acknowledged_signature": delivery["payload"]["alert_signature"],
            },
        }
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[[delivery]],
            update_result=[updated_delivery],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = acknowledge_admin_delivery_failure("failed-1", actor_user_id="admin-user-id")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].payload["acknowledged_by_user_id"], "admin-user-id")
        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(fake_supabase.insert_payloads[0][0]["action"], "acknowledged")

    def test_admin_can_clear_delivery_failure_acknowledgement(self):
        delivery = {
            "id": "delivery-1",
            "recipient_user_id": "admin-user-id",
            "transaction_kind": "order",
            "transaction_id": "order-1",
            "event_id": "delivery-failure:order-1",
            "channel": "email",
            "delivery_status": "sent",
            "payload": {
                "alert_type": "delivery_failure",
                "failed_delivery_id": "failed-1",
                "failed_delivery_channel": "email",
                "failed_delivery_status": "failed",
                "failed_delivery_attempts": 3,
                "failed_delivery_reason": "Provider timeout",
                "original_recipient_user_id": "buyer-1",
                "alert_signature": "delivery-failure:delivery-1",
                "acknowledged_at": "2026-04-08T12:00:00+00:00",
                "acknowledged_by_user_id": "admin-user-id",
                "acknowledged_signature": "delivery-failure:delivery-1",
            },
            "failure_reason": None,
            "attempts": 1,
            "sent_at": "2026-04-08T11:00:00+00:00",
            "created_at": "2026-04-08T11:00:00+00:00",
        }
        updated_delivery = {
            **delivery,
            "payload": {
                "alert_type": "delivery_failure",
                "failed_delivery_id": "failed-1",
                "failed_delivery_channel": "email",
                "failed_delivery_status": "failed",
                "failed_delivery_attempts": 3,
                "failed_delivery_reason": "Provider timeout",
                "original_recipient_user_id": "buyer-1",
                "alert_signature": delivery["payload"]["alert_signature"],
            },
        }
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[[delivery]],
            update_result=[updated_delivery],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = clear_admin_delivery_failure_acknowledgement("failed-1", actor_user_id="admin-user-id")

        self.assertEqual(len(result), 1)
        self.assertNotIn("acknowledged_at", result[0].payload)
        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(fake_supabase.insert_payloads[0][0]["action"], "cleared")

    def test_admin_can_group_delivery_failure_summaries(self):
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[
                [
                    {
                        "id": "delivery-1",
                        "recipient_user_id": "buyer-1",
                        "transaction_kind": "order",
                        "transaction_id": "order-1",
                        "channel": "email",
                        "delivery_status": "sent",
                        "payload": {
                            "alert_type": "delivery_failure",
                            "failed_delivery_id": "failed-1",
                            "failed_delivery_channel": "email",
                            "failed_delivery_status": "failed",
                            "failed_delivery_attempts": 3,
                            "failed_delivery_reason": "Provider timeout",
                            "original_recipient_user_id": "buyer-1",
                            "alert_signature": "delivery-failure:delivery-1",
                        },
                        "failure_reason": None,
                        "attempts": 1,
                        "created_at": "2026-04-08T12:00:00+00:00",
                    },
                    {
                        "id": "delivery-2",
                        "recipient_user_id": "buyer-1",
                        "transaction_kind": "order",
                        "transaction_id": "order-1",
                        "channel": "push",
                        "delivery_status": "sent",
                        "payload": {
                            "alert_type": "delivery_failure",
                            "failed_delivery_id": "failed-1",
                            "failed_delivery_channel": "email",
                            "failed_delivery_status": "failed",
                            "failed_delivery_attempts": 3,
                            "failed_delivery_reason": "Provider timeout",
                            "original_recipient_user_id": "buyer-1",
                            "alert_signature": "delivery-failure:delivery-1",
                        },
                        "failure_reason": None,
                        "attempts": 1,
                        "created_at": "2026-04-08T11:00:00+00:00",
                    },
                    {
                        "id": "delivery-3",
                        "recipient_user_id": "buyer-2",
                        "transaction_kind": "booking",
                        "transaction_id": "booking-1",
                        "channel": "email",
                        "delivery_status": "sent",
                        "payload": {
                            "alert_type": "delivery_failure",
                            "failed_delivery_id": "failed-2",
                            "failed_delivery_channel": "push",
                            "failed_delivery_status": "failed",
                            "failed_delivery_attempts": 2,
                            "failed_delivery_reason": "Push token invalid",
                            "original_recipient_user_id": "buyer-2",
                            "alert_signature": "delivery-failure:delivery-3",
                            "acknowledged_at": "2026-04-08T10:30:00+00:00",
                            "acknowledged_signature": "delivery-failure:delivery-3",
                        },
                        "failure_reason": None,
                        "attempts": 2,
                        "created_at": "2026-04-08T10:30:00+00:00",
                    },
                ],
            ],
            update_result=[],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = list_admin_delivery_failure_summaries(limit=8)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].failed_delivery_id, "failed-1")
        self.assertEqual(result[0].alert_delivery_count, 2)
        self.assertFalse(result[0].acknowledged)

    def test_admin_can_list_delivery_failure_events(self):
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[
                [
                    {
                        "id": "event-1",
                        "failed_delivery_id": "failed-1",
                        "delivery_id": "delivery-1",
                        "actor_user_id": "admin-user-id",
                        "action": "acknowledged",
                        "alert_signature": "delivery-failure:delivery-1",
                        "failed_delivery_channel": "email",
                        "failed_delivery_status": "failed",
                        "failed_delivery_attempts": 3,
                        "failed_delivery_reason": "Provider timeout",
                        "original_recipient_user_id": "buyer-1",
                        "created_at": "2026-04-08T12:00:00+00:00",
                    }
                ]
            ],
            update_result=[],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = list_admin_delivery_failure_events(limit=10)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].action, "acknowledged")

    def test_admin_can_acknowledge_inventory_alerts(self):
        delivery = {
            "id": "delivery-1",
            "recipient_user_id": "admin-user-id",
            "transaction_kind": "listing",
            "transaction_id": "listing-1",
            "event_id": "inventory-alert:listing-1:low_stock",
            "channel": "email",
            "delivery_status": "sent",
            "payload": {
                "alert_type": "inventory_alert",
                "seller_id": "seller-1",
                "seller_slug": "seller-one",
                "seller_display_name": "Seller One",
                "listing_id": "listing-1",
                "listing_title": "Weekend Tamales",
                "inventory_bucket": "low_stock",
                "inventory_count": 3,
                "alert_signature": "inventory-alert:listing-1:low_stock",
            },
            "failure_reason": None,
            "attempts": 1,
            "sent_at": "2026-04-08T11:00:00+00:00",
            "created_at": "2026-04-08T11:00:00+00:00",
        }
        updated_delivery = {
            **delivery,
            "payload": {
                **delivery["payload"],
                "acknowledged_at": "2026-04-08T12:00:00+00:00",
                "acknowledged_by_user_id": "admin-user-id",
                "acknowledged_signature": delivery["payload"]["alert_signature"],
            },
        }
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[[delivery]],
            update_result=[updated_delivery],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = acknowledge_admin_inventory_alert("seller-1", "listing-1", actor_user_id="admin-user-id")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].payload["acknowledged_by_user_id"], "admin-user-id")
        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(fake_supabase.insert_payloads[0][0]["action"], "acknowledged")

    def test_admin_can_clear_inventory_alert_acknowledgement(self):
        delivery = {
            "id": "delivery-1",
            "recipient_user_id": "admin-user-id",
            "transaction_kind": "listing",
            "transaction_id": "listing-1",
            "event_id": "inventory-alert:listing-1:low_stock",
            "channel": "email",
            "delivery_status": "sent",
            "payload": {
                "alert_type": "inventory_alert",
                "seller_id": "seller-1",
                "seller_slug": "seller-one",
                "seller_display_name": "Seller One",
                "listing_id": "listing-1",
                "listing_title": "Weekend Tamales",
                "inventory_bucket": "low_stock",
                "inventory_count": 3,
                "alert_signature": "inventory-alert:listing-1:low_stock",
                "acknowledged_at": "2026-04-08T12:00:00+00:00",
                "acknowledged_by_user_id": "admin-user-id",
                "acknowledged_signature": "inventory-alert:listing-1:low_stock",
            },
            "failure_reason": None,
            "attempts": 1,
            "sent_at": "2026-04-08T11:00:00+00:00",
            "created_at": "2026-04-08T11:00:00+00:00",
        }
        updated_delivery = {
            **delivery,
            "payload": {
                "alert_type": "inventory_alert",
                "seller_id": "seller-1",
                "seller_slug": "seller-one",
                "seller_display_name": "Seller One",
                "listing_id": "listing-1",
                "listing_title": "Weekend Tamales",
                "inventory_bucket": "low_stock",
                "inventory_count": 3,
                "alert_signature": delivery["payload"]["alert_signature"],
            },
        }
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[[delivery]],
            update_result=[updated_delivery],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = clear_admin_inventory_alert_acknowledgement("seller-1", "listing-1", actor_user_id="admin-user-id")

        self.assertEqual(len(result), 1)
        self.assertNotIn("acknowledged_at", result[0].payload)
        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(fake_supabase.insert_payloads[0][0]["action"], "cleared")

    def test_admin_can_group_inventory_alert_summaries(self):
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[
                [
                    {
                        "id": "delivery-1",
                        "recipient_user_id": "admin-user-id",
                        "transaction_kind": "listing",
                        "transaction_id": "listing-1",
                        "channel": "email",
                        "delivery_status": "sent",
                        "payload": {
                            "alert_type": "inventory_alert",
                            "seller_id": "seller-1",
                            "seller_slug": "seller-one",
                            "seller_display_name": "Seller One",
                            "listing_id": "listing-1",
                            "listing_title": "Weekend Tamales",
                            "inventory_bucket": "low_stock",
                            "inventory_count": 3,
                            "alert_signature": "inventory-alert:listing-1:low_stock",
                            "acknowledged_at": "2026-04-08T12:30:00+00:00",
                            "acknowledged_signature": "inventory-alert:listing-1:low_stock",
                        },
                        "created_at": "2026-04-08T12:00:00+00:00",
                    },
                    {
                        "id": "delivery-2",
                        "recipient_user_id": "admin-user-id",
                        "transaction_kind": "listing",
                        "transaction_id": "listing-1",
                        "channel": "push",
                        "delivery_status": "sent",
                        "payload": {
                            "alert_type": "inventory_alert",
                            "seller_id": "seller-1",
                            "seller_slug": "seller-one",
                            "seller_display_name": "Seller One",
                            "listing_id": "listing-1",
                            "listing_title": "Weekend Tamales",
                            "inventory_bucket": "low_stock",
                            "inventory_count": 2,
                            "alert_signature": "inventory-alert:listing-1:low_stock",
                            "acknowledged_at": "2026-04-08T11:30:00+00:00",
                            "acknowledged_signature": "inventory-alert:listing-1:low_stock",
                        },
                        "created_at": "2026-04-08T11:00:00+00:00",
                    },
                    {
                        "id": "delivery-3",
                        "recipient_user_id": "admin-user-id",
                        "transaction_kind": "listing",
                        "transaction_id": "listing-2",
                        "channel": "email",
                        "delivery_status": "queued",
                        "payload": {
                            "alert_type": "inventory_alert",
                            "seller_id": "seller-2",
                            "seller_slug": "seller-two",
                            "seller_display_name": "Seller Two",
                            "listing_id": "listing-2",
                            "listing_title": "Baked Goods Box",
                            "inventory_bucket": "out_of_stock",
                            "inventory_count": 0,
                            "alert_signature": "inventory-alert:listing-2:out_of_stock",
                        },
                        "created_at": "2026-04-08T10:30:00+00:00",
                    },
                ],
            ],
            update_result=[],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = list_admin_inventory_alert_summaries(limit=8, state="all")

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].seller_id, "seller-1")
        self.assertEqual(result[0].listing_id, "listing-1")
        self.assertEqual(result[0].alert_delivery_count, 2)
        self.assertTrue(result[0].acknowledged)

    def test_admin_can_list_inventory_alert_events(self):
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[
                [
                    {
                        "id": "event-1",
                        "seller_id": "seller-1",
                        "seller_slug": "seller-one",
                        "seller_display_name": "Seller One",
                        "delivery_id": "delivery-1",
                        "actor_user_id": "admin-user-id",
                        "action": "acknowledged",
                        "alert_signature": "inventory-alert:listing-1:low_stock",
                        "listing_id": "listing-1",
                        "listing_title": "Weekend Tamales",
                        "inventory_bucket": "low_stock",
                        "inventory_count": 3,
                        "created_at": "2026-04-08T12:00:00+00:00",
                    }
                ]
            ],
            update_result=[],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = list_admin_inventory_alert_events(limit=10)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].action, "acknowledged")

    def test_admin_can_acknowledge_subscription_downgrade_alerts(self):
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[
                [
                    {
                        "id": "delivery-1",
                        "recipient_user_id": "admin-user-id",
                        "transaction_kind": "seller",
                        "transaction_id": "seller-1",
                        "event_id": "subscription-downgrade:seller-1:subscription-1:tier-1:tier-0",
                        "channel": "email",
                        "delivery_status": "sent",
                        "payload": {
                            "alert_type": "subscription_downgrade",
                            "seller_id": "seller-1",
                            "seller_slug": "south-dallas-tamales",
                            "seller_display_name": "South Dallas Tamales",
                            "seller_subscription_id": "subscription-1",
                            "previous_tier_name": "Starter",
                            "current_tier_name": "Free",
                            "previous_tier_id": "tier-1",
                            "current_tier_id": "tier-0",
                            "reason_code": "plan_reset",
                            "note": "Plan reset",
                            "alert_signature": "subscription-downgrade:seller-1:subscription-1:tier-1:tier-0",
                        },
                        "failure_reason": None,
                        "attempts": 1,
                        "sent_at": "2026-04-08T11:00:00+00:00",
                        "created_at": "2026-04-08T11:00:00+00:00",
                    }
                ]
            ],
            update_result=[
                {
                    "id": "delivery-1",
                    "recipient_user_id": "admin-user-id",
                    "transaction_kind": "seller",
                    "transaction_id": "seller-1",
                    "event_id": "subscription-downgrade:seller-1:subscription-1:tier-1:tier-0",
                    "channel": "email",
                    "delivery_status": "sent",
                    "payload": {
                        "alert_type": "subscription_downgrade",
                        "seller_id": "seller-1",
                        "seller_slug": "south-dallas-tamales",
                        "seller_display_name": "South Dallas Tamales",
                        "seller_subscription_id": "subscription-1",
                        "previous_tier_name": "Starter",
                        "current_tier_name": "Free",
                        "previous_tier_id": "tier-1",
                        "current_tier_id": "tier-0",
                        "reason_code": "plan_reset",
                        "note": "Plan reset",
                        "alert_signature": "subscription-downgrade:seller-1:subscription-1:tier-1:tier-0",
                        "acknowledged_at": "2026-04-08T12:00:00+00:00",
                        "acknowledged_by_user_id": "admin-user-id",
                        "acknowledged_signature": "subscription-downgrade:seller-1:subscription-1:tier-1:tier-0",
                    },
                    "failure_reason": None,
                    "attempts": 1,
                    "sent_at": "2026-04-08T11:00:00+00:00",
                    "created_at": "2026-04-08T11:00:00+00:00",
                }
            ],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = acknowledge_admin_subscription_downgrade("seller-1", actor_user_id="admin-user-id")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].payload["acknowledged_by_user_id"], "admin-user-id")
        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(
            fake_supabase.insert_payloads[0][0]["action"],
            "acknowledged",
        )

    def test_admin_can_group_subscription_downgrade_summaries(self):
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[
                [
                    {
                        "id": "delivery-1",
                        "recipient_user_id": "admin-user-id",
                        "transaction_kind": "seller",
                        "transaction_id": "seller-1",
                        "event_id": "subscription-downgrade:seller-1:subscription-1:tier-1:tier-0",
                        "channel": "email",
                        "delivery_status": "sent",
                        "payload": {
                            "alert_type": "subscription_downgrade",
                            "seller_id": "seller-1",
                            "seller_slug": "south-dallas-tamales",
                            "seller_display_name": "South Dallas Tamales",
                            "seller_subscription_id": "subscription-1",
                            "previous_tier_name": "Starter",
                            "current_tier_name": "Free",
                            "previous_tier_id": "tier-1",
                            "current_tier_id": "tier-0",
                            "reason_code": "plan_reset",
                            "alert_signature": "subscription-downgrade:seller-1:subscription-1:tier-1:tier-0",
                        },
                        "failure_reason": None,
                        "attempts": 1,
                        "sent_at": "2026-04-08T11:00:00+00:00",
                        "created_at": "2026-04-08T11:00:00+00:00",
                    },
                    {
                        "id": "delivery-2",
                        "recipient_user_id": "admin-user-id",
                        "transaction_kind": "seller",
                        "transaction_id": "seller-1",
                        "event_id": "subscription-downgrade:seller-1:subscription-1:tier-1:tier-0",
                        "channel": "push",
                        "delivery_status": "queued",
                        "payload": {
                            "alert_type": "subscription_downgrade",
                            "seller_id": "seller-1",
                            "seller_slug": "south-dallas-tamales",
                            "seller_display_name": "South Dallas Tamales",
                            "seller_subscription_id": "subscription-1",
                            "previous_tier_name": "Starter",
                            "current_tier_name": "Free",
                            "previous_tier_id": "tier-1",
                            "current_tier_id": "tier-0",
                            "reason_code": "plan_reset",
                            "acknowledged_signature": "subscription-downgrade:seller-1:subscription-1:tier-1:tier-0",
                            "alert_signature": "subscription-downgrade:seller-1:subscription-1:tier-1:tier-0",
                        },
                        "failure_reason": None,
                        "attempts": 1,
                        "sent_at": None,
                        "created_at": "2026-04-08T12:00:00+00:00",
                    },
                ],
            ],
            update_result=[],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = list_admin_subscription_downgrade_seller_summaries(limit=8, state="all")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].seller_id, "seller-1")
        self.assertEqual(result[0].alert_delivery_count, 2)
        self.assertTrue(result[0].acknowledged)

    def test_admin_can_list_subscription_downgrade_events(self):
        fake_supabase = _FakeNotificationSupabase(
            select_side_effect=[
                [
                    {
                        "id": "event-1",
                        "seller_id": "seller-1",
                        "seller_slug": "south-dallas-tamales",
                        "seller_display_name": "South Dallas Tamales",
                        "delivery_id": "delivery-1",
                        "actor_user_id": "admin-user-id",
                        "action": "acknowledged",
                        "alert_signature": "subscription-downgrade:seller-1:subscription-1:tier-1:tier-0",
                        "seller_subscription_id": "subscription-1",
                        "from_tier_id": "tier-1",
                        "from_tier_name": "Starter",
                        "to_tier_id": "tier-0",
                        "to_tier_name": "Free",
                        "reason_code": "plan_reset",
                        "note": "Plan reset",
                        "created_at": "2026-04-08T12:00:00+00:00",
                    }
                ]
            ],
            update_result=[],
        )

        with patch("app.services.notification_deliveries.get_supabase_client", return_value=fake_supabase):
            result = list_admin_subscription_downgrade_events(limit=10)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].action, "acknowledged")


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


class _FakeNotificationSupabase(_FakeSupabase):
    def __init__(self, *, select_side_effect, update_result):
        super().__init__(select_side_effect=select_side_effect, update_result=update_result)
        self.insert_calls = 0
        self.insert_payloads = []

    def insert(self, table, payload, **kwargs):
        if table not in {
            "order_exception_events",
            "booking_conflict_events",
            "delivery_failure_events",
            "inventory_alert_events",
            "subscription_downgrade_events",
            "review_response_reminder_events",
            "trust_alert_events",
        }:
            raise AssertionError(f"Unexpected insert table: {table}")
        self.insert_calls += 1
        self.insert_payloads.append(payload)
        return payload


if __name__ == "__main__":
    unittest.main()
