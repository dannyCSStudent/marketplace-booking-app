from datetime import datetime
import unittest
from unittest.mock import patch

from app.services.seller_inactivity import (
    acknowledge_seller_inactivity_alert,
    clear_seller_inactivity_acknowledgement,
    list_seller_inactivity_summaries,
    sync_seller_inactivity_alerts,
)


class SellerInactivityTests(unittest.TestCase):
    def test_sync_seller_inactivity_alerts_queues_notifications(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                [
                    {
                        "id": "seller-1",
                        "user_id": "seller-user-1",
                        "display_name": "Seller One",
                        "slug": "seller-one",
                        "updated_at": "2026-03-01T12:00:00+00:00",
                    }
                ],
                [],
                [],
                [],
                [
                    {
                        "id": "admin-user-id",
                        "email_notifications_enabled": True,
                        "push_notifications_enabled": True,
                    },
                    {
                        "id": "seller-user-1",
                        "email_notifications_enabled": True,
                        "push_notifications_enabled": False,
                    },
                ],
                [],
            ],
            insert_result=[
                {
                    "id": "delivery-1",
                    "recipient_user_id": "admin-user-id",
                    "transaction_kind": "seller",
                    "transaction_id": "seller-1",
                    "event_id": "seller-inactivity:seller-1:seller_profile_updated:5:high",
                    "channel": "email",
                    "delivery_status": "queued",
                    "payload": {
                        "alert_type": "seller_inactivity",
                        "seller_id": "seller-1",
                        "seller_slug": "seller-one",
                        "seller_display_name": "Seller One",
                        "last_active_at": "2026-03-01T12:00:00+00:00",
                        "last_active_kind": "seller_profile_updated",
                        "idle_days": 41,
                        "severity": "high",
                        "tone": "rose",
                        "action_label": "Review seller activity",
                        "alert_reason": "Seller One has been idle for 41 days.",
                        "alert_signature": "seller-inactivity:seller-1:seller_profile_updated:5",
                    },
                    "created_at": "2026-04-11T12:00:00+00:00",
                }
            ],
        )
        settings = type(
            "Settings",
            (),
            {
                "admin_user_ids": ["admin-user-id"],
                "admin_user_roles": {"admin-user-id": "owner"},
            },
        )()

        with (
            patch("app.services.seller_inactivity.get_supabase_client", return_value=fake_supabase),
            patch("app.services.seller_inactivity.get_settings", return_value=settings),
            patch("app.services.seller_inactivity.process_notification_delivery_rows") as mock_process,
            patch("app.services.seller_inactivity.datetime") as mock_datetime,
        ):
            mock_datetime.now.return_value = datetime.fromisoformat("2026-04-11T12:00:00+00:00")
            mock_datetime.fromisoformat.side_effect = lambda value: datetime.fromisoformat(value)

            sync_seller_inactivity_alerts()

        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(len(fake_supabase.insert_payloads[0]), 3)
        self.assertEqual(fake_supabase.insert_payloads[0][0]["payload"]["alert_type"], "seller_inactivity")
        mock_process.assert_called_once()

    def test_list_seller_inactivity_summaries_groups_acknowledged_rows(self):
        active_rows = [
            {
                "id": "delivery-1",
                "recipient_user_id": "admin-user-id",
                "transaction_kind": "seller",
                "transaction_id": "seller-1",
                "event_id": "seller-inactivity:seller-1:seller_profile_updated:5:high",
                "channel": "email",
                "delivery_status": "sent",
                "payload": {
                    "alert_type": "seller_inactivity",
                    "seller_id": "seller-1",
                    "seller_slug": "seller-one",
                    "seller_display_name": "Seller One",
                    "last_active_at": "2026-03-01T12:00:00+00:00",
                    "last_active_kind": "seller_profile_updated",
                    "idle_days": 41,
                    "severity": "high",
                    "tone": "rose",
                    "action_label": "Review seller activity",
                    "alert_reason": "Seller One has been idle for 41 days.",
                    "alert_signature": "seller-inactivity:seller-1:seller_profile_updated:5",
                    "acknowledged_at": "2026-04-11T12:30:00+00:00",
                    "acknowledged_signature": "seller-inactivity:seller-1:seller_profile_updated:5",
                },
                "created_at": "2026-04-11T12:00:00+00:00",
            },
            {
                "id": "delivery-2",
                "recipient_user_id": "admin-user-id",
                "transaction_kind": "seller",
                "transaction_id": "seller-2",
                "event_id": "seller-inactivity:seller-2:order_created:3:medium",
                "channel": "push",
                "delivery_status": "queued",
                "payload": {
                    "alert_type": "seller_inactivity",
                    "seller_id": "seller-2",
                    "seller_slug": "seller-two",
                    "seller_display_name": "Seller Two",
                    "last_active_at": "2026-03-20T12:00:00+00:00",
                    "last_active_kind": "order_created",
                    "idle_days": 22,
                    "severity": "medium",
                    "tone": "amber",
                    "action_label": "Review seller activity",
                    "alert_reason": "Seller Two has been idle for 22 days.",
                    "alert_signature": "seller-inactivity:seller-2:order_created:3",
                },
                "created_at": "2026-04-11T11:00:00+00:00",
            },
        ]
        acknowledged_rows = [active_rows[0]]

        with (
            patch("app.services.seller_inactivity.sync_seller_inactivity_alerts"),
            patch(
                "app.services.seller_inactivity.get_supabase_client",
                side_effect=[
                    _FakeSupabase(select_side_effect=[active_rows]),
                    _FakeSupabase(select_side_effect=[acknowledged_rows]),
                ],
            ),
        ):
            active = list_seller_inactivity_summaries(limit=10, state="active")
            acknowledged = list_seller_inactivity_summaries(limit=10, state="acknowledged")

        self.assertEqual(len(active), 1)
        self.assertEqual(active[0].seller_id, "seller-2")
        self.assertFalse(active[0].acknowledged)
        self.assertEqual(active[0].severity, "medium")
        self.assertEqual(len(acknowledged), 1)
        self.assertEqual(acknowledged[0].seller_id, "seller-1")
        self.assertTrue(acknowledged[0].acknowledged)

    def test_acknowledge_and_clear_updates_activity_events(self):
        delivery = {
            "id": "delivery-1",
            "recipient_user_id": "admin-user-id",
            "transaction_kind": "seller",
            "transaction_id": "seller-1",
            "event_id": "seller-inactivity:seller-1:seller_profile_updated:5:high",
            "channel": "email",
            "delivery_status": "sent",
            "payload": {
                "alert_type": "seller_inactivity",
                "seller_id": "seller-1",
                "seller_slug": "seller-one",
                "seller_display_name": "Seller One",
                "last_active_at": "2026-03-01T12:00:00+00:00",
                "last_active_kind": "seller_profile_updated",
                "idle_days": 41,
                "severity": "high",
                "tone": "rose",
                "action_label": "Review seller activity",
                "alert_reason": "Seller One has been idle for 41 days.",
                "alert_signature": "seller-inactivity:seller-1:seller_profile_updated:5",
            },
            "created_at": "2026-04-11T12:00:00+00:00",
        }
        acknowledged_delivery = {
            **delivery,
            "payload": {
                **delivery["payload"],
                "acknowledged_at": "2026-04-11T12:30:00+00:00",
                "acknowledged_by_user_id": "admin-user-id",
                "acknowledged_signature": delivery["payload"]["alert_signature"],
            },
        }
        cleared_delivery = {
            **delivery,
            "payload": {
                **delivery["payload"],
                "acknowledged_at": None,
                "acknowledged_by_user_id": None,
                "acknowledged_signature": None,
            },
        }
        fake_supabase = _FakeSupabase(
            select_side_effect=[[delivery], [acknowledged_delivery], [cleared_delivery]],
            update_result=[[acknowledged_delivery], [cleared_delivery]],
            insert_result=[],
        )

        with patch("app.services.seller_inactivity.get_supabase_client", return_value=fake_supabase):
            ack_result = acknowledge_seller_inactivity_alert("seller-1", actor_user_id="admin-user-id")
            clear_result = clear_seller_inactivity_acknowledgement("seller-1", actor_user_id="admin-user-id")

        self.assertEqual(len(ack_result), 1)
        self.assertEqual(ack_result[0]["payload"]["acknowledged_by_user_id"], "admin-user-id")
        self.assertEqual(len(clear_result), 1)
        self.assertIsNone(clear_result[0]["payload"].get("acknowledged_at"))
        self.assertIsNone(clear_result[0]["payload"].get("acknowledged_by_user_id"))
        self.assertIsNone(clear_result[0]["payload"].get("acknowledged_signature"))


class _FakeSupabase:
    def __init__(
        self,
        *,
        select_side_effect: list[object],
        update_result: list[object] | None = None,
        insert_result: list[object] | None = None,
    ) -> None:
        self.select_side_effect = list(select_side_effect)
        self.update_result = list(update_result or [])
        self.insert_result = insert_result or []
        self.insert_calls = 0
        self.insert_payloads: list[list[dict[str, object]]] = []

    def select(self, *_args, **_kwargs):
        if not self.select_side_effect:
            return []
        return self.select_side_effect.pop(0)

    def insert(self, _table, payload, **_kwargs):
        self.insert_calls += 1
        rows = payload if isinstance(payload, list) else [payload]
        self.insert_payloads.append(rows)
        return self.insert_result or rows

    def update(self, _table, payload, **_kwargs):
        if self.update_result:
            return self.update_result.pop(0)
        return [payload]
