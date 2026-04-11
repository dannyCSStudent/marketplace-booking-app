import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.schemas.subscriptions import SellerSubscriptionEventRead, SubscriptionTierRead
from app.services.monetization_watchlist import (
    acknowledge_monetization_watchlist_alert,
    list_monetization_watchlist_alerts,
    list_monetization_watchlist_events,
    list_monetization_watchlist_summaries,
)


class MonetizationWatchlistServiceTests(unittest.TestCase):
    def test_lists_backend_watchlist_alerts_from_recent_movement(self):
        since_at = datetime(2026, 4, 1, tzinfo=timezone.utc)
        tiers = [
            SubscriptionTierRead(
                id="tier-starter",
                code="starter",
                name="Starter",
                monthly_price_cents=1900,
                analytics_enabled=True,
                priority_visibility=False,
                premium_storefront=False,
                is_active=True,
                created_at=datetime(2026, 3, 1, tzinfo=timezone.utc),
            ),
            SubscriptionTierRead(
                id="tier-free",
                code="free",
                name="Free",
                monthly_price_cents=0,
                analytics_enabled=False,
                priority_visibility=False,
                premium_storefront=False,
                is_active=True,
                created_at=datetime(2026, 3, 1, tzinfo=timezone.utc),
            ),
        ]
        events = [
            SellerSubscriptionEventRead(
                id="event-1",
                seller_id="seller-1",
                seller_slug="south-dallas-tamales",
                seller_display_name="South Dallas Tamales",
                seller_subscription_id="subscription-1",
                actor_user_id="admin-user-1",
                actor_name="Admin",
                action="downgrade",
                reason_code="plan_reset",
                from_tier_id="tier-starter",
                from_tier_code="starter",
                from_tier_name="Starter",
                to_tier_id="tier-free",
                to_tier_code="free",
                to_tier_name="Free",
                note=None,
                created_at=datetime(2026, 4, 8, tzinfo=timezone.utc),
            )
        ]
        promotion_events = [
            {
                "id": "promotion-event-1",
                "listing_id": "listing-1",
                "seller_id": "seller-1",
                "promoted": False,
                "platform_fee_rate": "0.1",
                "created_at": datetime(2026, 4, 8, tzinfo=timezone.utc).isoformat(),
            }
        ]

        with (
            patch("app.services.monetization_watchlist.list_subscription_events", return_value=events),
            patch("app.services.monetization_watchlist.list_subscription_tiers", return_value=tiers),
            patch("app.services.monetization_watchlist.list_promotion_events", return_value=promotion_events),
            patch(
                "app.services.monetization_watchlist.list_promoted_summary",
                return_value=[{"type": "product", "count": 2}],
            ),
        ):
            alerts = list_monetization_watchlist_alerts(since_at=since_at)

        self.assertEqual(len(alerts), 4)
        self.assertTrue(all(alert.signature.startswith("since-visit:") for alert in alerts))
        self.assertEqual(alerts[0].replay_key, "subscription_destructive")
        self.assertEqual(alerts[1].replay_key, "subscription_downgrade")
        self.assertEqual(alerts[2].replay_key, "promotion_removals")
        self.assertEqual(alerts[3].replay_key, "promoted_listings")

    def test_lists_backend_watchlist_summaries_and_events(self):
        class _Supabase:
            def __init__(self):
                self.insert_calls = []

            def select(self, table, **kwargs):
                if table == "monetization_watchlist_events":
                    return [
                        {
                            "id": "event-1",
                            "alert_id": "subscription-downgrade-pressure",
                            "alert_signature": "since-visit:1",
                            "actor_user_id": "admin-1",
                            "action": "acknowledged",
                            "alert_title": "Downgrade pressure needs review",
                            "alert_severity": "medium",
                            "created_at": "2026-04-08T12:00:00Z",
                        }
                    ]
                raise AssertionError(f"Unexpected select table: {table}")

            def insert(self, table, payload, **kwargs):
                self.insert_calls.append((table, payload, kwargs))
                return [
                    {
                        "id": "event-2",
                        "alert_id": payload["alert_id"],
                        "alert_signature": payload["alert_signature"],
                        "actor_user_id": payload["actor_user_id"],
                        "action": payload["action"],
                        "alert_title": payload["alert_title"],
                        "alert_severity": payload["alert_severity"],
                        "created_at": "2026-04-09T12:00:00Z",
                    }
                ]

        fake_supabase = _Supabase()
        with (
            patch("app.services.monetization_watchlist.get_supabase_client", return_value=fake_supabase),
            patch(
                "app.services.monetization_watchlist.list_monetization_watchlist_alerts",
                return_value=[
                    type(
                        "Alert",
                        (),
                        {
                            "id": "subscription-downgrade-pressure",
                            "signature": "since-visit:1",
                            "title": "Downgrade pressure needs review",
                            "detail": "1 seller downgrade since your last visit.",
                            "severity": "medium",
                            "tone": "amber",
                            "action_label": "Open downgrade slice",
                            "replay_key": "subscription_downgrade",
                            "created_at": datetime(2026, 4, 8, tzinfo=timezone.utc),
                        },
                    )()
                ],
            ),
        ):
            summaries = list_monetization_watchlist_summaries(
                since_at=datetime(2026, 4, 1, tzinfo=timezone.utc),
                limit=10,
                state="acknowledged",
            )
            events = list_monetization_watchlist_events(limit=10)
            acked = acknowledge_monetization_watchlist_alert(
                "subscription-downgrade-pressure",
                actor_user_id="admin-2",
                since_at=datetime(2026, 4, 1, tzinfo=timezone.utc),
            )

        self.assertEqual(len(summaries), 1)
        self.assertTrue(summaries[0].acknowledged)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].action, "acknowledged")
        self.assertEqual(fake_supabase.insert_calls[0][0], "monetization_watchlist_events")
        self.assertEqual(acked[0]["action"], "acknowledged")


if __name__ == "__main__":
    unittest.main()
