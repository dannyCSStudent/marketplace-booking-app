import unittest
from unittest.mock import MagicMock, patch

from app.services.notification_delivery_worker import process_notification_deliveries


class NotificationDeliveryWorkerTests(unittest.TestCase):
    def test_processes_log_provider_delivery_as_sent(self):
        fake_supabase = _FakeSupabase(
            select_results=[
                [
                    {
                        "id": "delivery-1",
                        "recipient_user_id": "user-1",
                        "transaction_kind": "order",
                        "transaction_id": "order-1",
                        "event_id": "event-1",
                        "channel": "email",
                        "payload": {"status": "confirmed"},
                        "attempts": 0,
                        "next_attempt_at": "2026-03-31T00:00:00+00:00",
                    }
                ]
            ]
        )

        settings = _settings(
            notification_email_provider="log",
            notification_push_provider="log",
        )

        with (
            patch("app.services.notification_delivery_worker.get_supabase_client", return_value=fake_supabase),
            patch("app.services.notification_delivery_worker.get_settings", return_value=settings),
        ):
            result = process_notification_deliveries(batch_size=10)

        self.assertEqual(result["processed"], 1)
        self.assertEqual(result["sent"], 1)
        self.assertEqual(fake_supabase.update_payloads[0]["delivery_status"], "processing")
        self.assertEqual(fake_supabase.update_payloads[1]["delivery_status"], "sent")

    def test_requeues_failed_delivery_before_max_attempts(self):
        fake_supabase = _FakeSupabase(
            select_results=[
                [
                    {
                        "id": "delivery-1",
                        "recipient_user_id": "user-1",
                        "transaction_kind": "booking",
                        "transaction_id": "booking-1",
                        "event_id": "event-1",
                        "channel": "push",
                        "payload": {"status": "confirmed"},
                        "attempts": 0,
                        "next_attempt_at": "2026-03-31T00:00:00+00:00",
                    }
                ]
            ]
        )

        settings = _settings(
            notification_email_provider="log",
            notification_push_provider="log",
        )

        with (
            patch("app.services.notification_delivery_worker.get_supabase_client", return_value=fake_supabase),
            patch("app.services.notification_delivery_worker.get_settings", return_value=settings),
            patch(
                "app.services.notification_delivery_worker._dispatch_delivery",
                side_effect=RuntimeError("provider down"),
            ),
        ):
            result = process_notification_deliveries(batch_size=10)

        self.assertEqual(result["failed"], 1)
        self.assertEqual(fake_supabase.update_payloads[-1]["delivery_status"], "queued")
        self.assertIn("provider down", fake_supabase.update_payloads[-1]["failure_reason"])

    def test_final_failed_delivery_queues_admin_alert(self):
        fake_supabase = _FakeSupabase(
            select_results=[
                [
                    {
                        "id": "delivery-1",
                        "recipient_user_id": "user-1",
                        "transaction_kind": "order",
                        "transaction_id": "order-1",
                        "event_id": "event-1",
                        "channel": "email",
                        "payload": {"status": "confirmed"},
                        "attempts": 2,
                        "next_attempt_at": "2026-03-31T00:00:00+00:00",
                    }
                ],
                [{"id": "admin-1", "email_notifications_enabled": True, "push_notifications_enabled": False}],
                [],
            ]
        )

        settings = _settings(
            notification_email_provider="log",
            notification_push_provider="log",
            admin_user_ids=["admin-1"],
            admin_user_roles={"admin-1": "owner"},
        )

        with (
            patch("app.services.notification_delivery_worker.get_supabase_client", return_value=fake_supabase),
            patch("app.services.notification_delivery_worker.get_settings", return_value=settings),
            patch(
                "app.services.notification_delivery_worker._dispatch_delivery",
                side_effect=RuntimeError("provider down"),
            ),
            patch(
                "app.services.notification_delivery_worker.queue_admin_delivery_failure_notifications",
            ) as mock_queue_alert,
        ):
            result = process_notification_deliveries(batch_size=10)

        self.assertEqual(result["failed"], 1)
        self.assertEqual(fake_supabase.update_payloads[-1]["delivery_status"], "failed")
        mock_queue_alert.assert_called_once()

    def test_resend_delivery_uses_auth_email_lookup(self):
        fake_supabase = _FakeSupabase(select_results=[])
        fake_response = MagicMock()
        fake_response.__enter__.return_value.read.return_value = b'{"id":"email-1"}'
        fake_response.__exit__.return_value = False

        delivery = {
            "recipient_user_id": "user-1",
            "payload": {
                "subject": "Your order is confirmed",
                "html": "<p>Confirmed</p>",
            },
        }
        settings = type(
            "Settings",
            (),
            {
                "resend_api_key": "re_test",
                "notification_from_email": "Acme <onboarding@resend.dev>",
            },
        )()

        fake_supabase.get_auth_user_result = {"email": "buyer@example.com"}

        with (
            patch("app.services.notification_delivery_worker.get_supabase_client", return_value=fake_supabase),
            patch("app.services.notification_delivery_worker.urlopen", return_value=fake_response) as mock_urlopen,
        ):
            from app.services.notification_delivery_worker import _send_resend_email

            _send_resend_email(delivery=delivery, settings=settings)

        request = mock_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.resend.com/emails")
        self.assertIn(b"buyer@example.com", request.data)

    def test_expo_push_delivery_uses_profile_push_token_lookup(self):
        fake_supabase = _FakeSupabase(
            select_results=[{"expo_push_token": "ExponentPushToken[test-token]"}]
        )
        fake_response = MagicMock()
        fake_response.__enter__.return_value.read.return_value = (
            b'{"data":{"status":"ok","id":"push-1"}}'
        )
        fake_response.__exit__.return_value = False

        delivery = {
            "recipient_user_id": "user-1",
            "transaction_kind": "booking",
            "transaction_id": "booking-1",
            "event_id": "event-1",
            "payload": {
                "subject": "Your booking is confirmed",
                "body": "The seller confirmed your booking.",
                "status": "confirmed",
            },
        }
        settings = type(
            "Settings",
            (),
            {
                "expo_access_token": None,
            },
        )()

        with (
            patch("app.services.notification_delivery_worker.get_supabase_client", return_value=fake_supabase),
            patch("app.services.notification_delivery_worker.urlopen", return_value=fake_response) as mock_urlopen,
        ):
            from app.services.notification_delivery_worker import _send_expo_push

            _send_expo_push(delivery=delivery, settings=settings)

        request = mock_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://exp.host/--/api/v2/push/send")
        self.assertIn(b"ExponentPushToken[test-token]", request.data)


class _FakeSupabase:
    def __init__(self, *, select_results):
        self._select_results = list(select_results)
        self.update_payloads = []
        self.get_auth_user_result = None

    def select(self, *args, **kwargs):
        if not self._select_results:
            raise AssertionError("Unexpected select call")
        return self._select_results.pop(0)

    def update(self, table, payload, **kwargs):
        self.update_payloads.append(payload)
        return [payload]

    def get_auth_user(self, user_id):
        if self.get_auth_user_result is None:
            raise AssertionError("Unexpected get_auth_user call")
        return self.get_auth_user_result


def _settings(**overrides):
    defaults = {
        "notification_email_provider": "log",
        "notification_push_provider": "log",
        "notification_email_webhook_url": None,
        "notification_push_webhook_url": None,
        "notification_max_attempts": 3,
        "resend_api_key": None,
        "expo_access_token": None,
        "notification_from_email": "onboarding@resend.dev",
    }
    defaults.update(overrides)
    return type("Settings", (), defaults)()


if __name__ == "__main__":
    unittest.main()
