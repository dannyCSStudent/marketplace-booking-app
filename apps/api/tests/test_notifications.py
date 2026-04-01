import unittest
from unittest.mock import patch

from app.services.notifications import queue_transaction_notification_jobs


class NotificationQueueTests(unittest.TestCase):
    def test_queues_email_and_push_when_both_channels_enabled(self):
        fake_supabase = _FakeSupabase(
            select_results=[
                {
                    "id": "user-1",
                    "email_notifications_enabled": True,
                    "push_notifications_enabled": True,
                }
            ]
        )

        with patch("app.services.notifications.get_supabase_client", return_value=fake_supabase):
            queue_transaction_notification_jobs(
                recipient_user_id="user-1",
                transaction_kind="order",
                transaction_id="order-1",
                event_id="event-1",
                status_value="confirmed",
                actor_role="seller",
                note="Ready after 5pm.",
            )

        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(len(fake_supabase.insert_payloads[0]), 2)
        self.assertEqual(
            {row["channel"] for row in fake_supabase.insert_payloads[0]},
            {"email", "push"},
        )
        email_delivery = next(
            row for row in fake_supabase.insert_payloads[0] if row["channel"] == "email"
        )
        self.assertIn("subject", email_delivery["payload"])
        self.assertIn("html", email_delivery["payload"])

    def test_skips_queue_when_all_channels_disabled(self):
        fake_supabase = _FakeSupabase(
            select_results=[
                {
                    "id": "user-1",
                    "email_notifications_enabled": False,
                    "push_notifications_enabled": False,
                }
            ]
        )

        with patch("app.services.notifications.get_supabase_client", return_value=fake_supabase):
            queue_transaction_notification_jobs(
                recipient_user_id="user-1",
                transaction_kind="booking",
                transaction_id="booking-1",
                event_id="event-1",
                status_value="confirmed",
                actor_role="seller",
                note="See you tomorrow.",
            )

        self.assertEqual(fake_supabase.insert_calls, 0)


class _FakeSupabase:
    def __init__(self, *, select_results):
        self._select_results = list(select_results)
        self.insert_calls = 0
        self.insert_payloads = []

    def select(self, *args, **kwargs):
        if not self._select_results:
            raise AssertionError("Unexpected select call")
        return self._select_results.pop(0)

    def insert(self, table, payload, **kwargs):
        self.insert_calls += 1
        self.insert_payloads.append(payload)
        return payload


if __name__ == "__main__":
    unittest.main()
