import unittest
from unittest.mock import patch

from app.dependencies.auth import CurrentUser
from app.schemas.subscriptions import SellerSubscriptionAssign, SubscriptionTierCreate
from app.services.subscriptions import (
    assign_seller_subscription,
    create_subscription_tier,
    get_my_seller_subscription,
    get_seller_subscription_by_slug,
    list_subscription_events,
)


class SubscriptionServiceTests(unittest.TestCase):
    def test_creates_subscription_tier(self):
        fake_supabase = _FakeSupabase(
            select_results=[],
            insert_results=[
                [
                    {
                        "id": "tier-1",
                        "code": "starter",
                        "name": "Starter",
                        "monthly_price_cents": 1900,
                        "perks_summary": "Analytics",
                        "analytics_enabled": True,
                        "priority_visibility": False,
                        "premium_storefront": False,
                        "is_active": True,
                        "created_at": "2026-04-07T16:00:00Z",
                    }
                ]
            ],
        )

        with patch("app.services.subscriptions.get_supabase_client", return_value=fake_supabase):
            tier = create_subscription_tier(
                SubscriptionTierCreate(
                    code="starter",
                    name="Starter",
                    monthly_price_cents=1900,
                    perks_summary="Analytics",
                    analytics_enabled=True,
                )
            )

        self.assertEqual(tier.code, "starter")
        self.assertEqual(tier.monthly_price_cents, 1900)
        self.assertEqual(fake_supabase.insert_calls[0][0], "subscription_tiers")

    def test_assigns_new_active_subscription_and_closes_existing_one(self):
        fake_supabase = _FakeSupabase(
            select_results=[
                {"id": "seller-1", "display_name": "South Dallas Tamales", "slug": "south-dallas-tamales"},
                {
                    "id": "tier-1",
                    "code": "starter",
                    "name": "Starter",
                    "monthly_price_cents": 1900,
                    "perks_summary": None,
                    "analytics_enabled": True,
                    "priority_visibility": False,
                    "premium_storefront": False,
                    "is_active": True,
                    "created_at": "2026-04-07T16:00:00Z",
                },
                {
                    "id": "previous-subscription-1",
                    "seller_id": "seller-1",
                    "tier_id": "tier-0",
                    "started_at": "2026-04-01T16:05:00Z",
                    "ended_at": None,
                    "is_active": True,
                    "created_at": "2026-04-01T16:05:00Z",
                    "seller_profiles": {"display_name": "South Dallas Tamales", "slug": "south-dallas-tamales"},
                    "subscription_tiers": {
                        "code": "free",
                        "name": "Free",
                        "monthly_price_cents": 0,
                        "perks_summary": None,
                        "analytics_enabled": False,
                        "priority_visibility": False,
                        "premium_storefront": False,
                    },
                },
                {
                    "id": "subscription-1",
                    "seller_id": "seller-1",
                    "tier_id": "tier-1",
                    "started_at": "2026-04-07T16:05:00Z",
                    "ended_at": None,
                    "is_active": True,
                    "created_at": "2026-04-07T16:05:00Z",
                    "seller_profiles": {"display_name": "South Dallas Tamales", "slug": "south-dallas-tamales"},
                    "subscription_tiers": {
                        "code": "starter",
                        "name": "Starter",
                        "monthly_price_cents": 1900,
                        "perks_summary": "Analytics enabled",
                        "analytics_enabled": True,
                        "priority_visibility": False,
                        "premium_storefront": False,
                    },
                },
            ],
            insert_results=[[{"id": "subscription-1"}]],
        )

        with patch("app.services.subscriptions.get_supabase_client", return_value=fake_supabase):
            subscription = assign_seller_subscription(
                SellerSubscriptionAssign(
                    seller_slug="south-dallas-tamales",
                    tier_id="tier-1",
                    reason_code="manual_upgrade",
                ),
                actor_user_id="admin-user-1",
            )

        self.assertEqual(subscription.seller_slug, "south-dallas-tamales")
        self.assertEqual(subscription.tier_code, "starter")
        self.assertTrue(subscription.analytics_enabled)
        self.assertEqual(fake_supabase.update_calls[0][0], "seller_subscriptions")
        self.assertEqual(fake_supabase.insert_calls[0][0], "seller_subscriptions")
        self.assertEqual(fake_supabase.insert_calls[1][0], "seller_subscription_events")
        self.assertEqual(fake_supabase.insert_calls[1][1]["reason_code"], "manual_upgrade")

    def test_assigning_lower_tier_queues_subscription_downgrade_alerts(self):
        fake_supabase = _FakeSupabase(
            select_results=[
                {
                    "id": "seller-1",
                    "user_id": "seller-user-1",
                    "display_name": "South Dallas Tamales",
                    "slug": "south-dallas-tamales",
                },
                {
                    "id": "tier-0",
                    "code": "free",
                    "name": "Free",
                    "monthly_price_cents": 0,
                    "perks_summary": None,
                    "analytics_enabled": False,
                    "priority_visibility": False,
                    "premium_storefront": False,
                    "is_active": True,
                    "created_at": "2026-04-01T16:00:00Z",
                },
                {
                    "id": "previous-subscription-1",
                    "seller_id": "seller-1",
                    "tier_id": "tier-1",
                    "started_at": "2026-04-01T16:05:00Z",
                    "ended_at": None,
                    "is_active": True,
                    "created_at": "2026-04-01T16:05:00Z",
                    "seller_profiles": {"display_name": "South Dallas Tamales", "slug": "south-dallas-tamales"},
                    "subscription_tiers": {
                        "id": "tier-1",
                        "code": "starter",
                        "name": "Starter",
                        "monthly_price_cents": 1900,
                        "perks_summary": None,
                        "analytics_enabled": True,
                        "priority_visibility": False,
                        "premium_storefront": False,
                    },
                },
                {
                    "id": "subscription-2",
                    "seller_id": "seller-1",
                    "tier_id": "tier-0",
                    "started_at": "2026-04-07T16:05:00Z",
                    "ended_at": None,
                    "is_active": True,
                    "created_at": "2026-04-07T16:05:00Z",
                    "seller_profiles": {"display_name": "South Dallas Tamales", "slug": "south-dallas-tamales"},
                    "subscription_tiers": {
                        "id": "tier-0",
                        "code": "free",
                        "name": "Free",
                        "monthly_price_cents": 0,
                        "perks_summary": None,
                        "analytics_enabled": False,
                        "priority_visibility": False,
                        "premium_storefront": False,
                    },
                },
                [],
                [
                    {
                        "id": "seller-user-1",
                        "email_notifications_enabled": True,
                        "push_notifications_enabled": True,
                    },
                    {
                        "id": "admin-user-1",
                        "email_notifications_enabled": True,
                        "push_notifications_enabled": False,
                    },
                ],
            ],
            insert_results=[
                [{"id": "subscription-2"}],
                [{"id": "delivery-1"}],
            ],
        )

        fake_settings = type(
            "Settings",
            (),
            {
                "admin_user_ids": ["admin-user-1"],
                "admin_user_roles": {"admin-user-1": "monetization"},
            },
        )()

        with (
            patch("app.services.subscriptions.get_supabase_client", return_value=fake_supabase),
            patch("app.services.subscriptions.get_settings", return_value=fake_settings),
            patch("app.services.subscriptions.process_notification_delivery_rows") as process_rows,
        ):
            subscription = assign_seller_subscription(
                SellerSubscriptionAssign(
                    seller_slug="south-dallas-tamales",
                    tier_id="tier-0",
                    reason_code="plan_reset",
                ),
                actor_user_id="admin-user-1",
            )

        self.assertEqual(subscription.tier_code, "free")
        self.assertEqual(fake_supabase.insert_calls[2][0], "notification_deliveries")
        self.assertEqual(fake_supabase.insert_calls[2][1][0]["payload"]["alert_type"], "subscription_downgrade")
        process_rows.assert_called_once()

    def test_reads_my_active_seller_subscription(self):
        fake_supabase = _FakeSupabase(
            select_results=[
                {"id": "seller-1"},
                {
                    "id": "subscription-1",
                    "seller_id": "seller-1",
                    "tier_id": "tier-1",
                    "started_at": "2026-04-07T16:05:00Z",
                    "ended_at": None,
                    "is_active": True,
                    "created_at": "2026-04-07T16:05:00Z",
                    "seller_profiles": {"display_name": "South Dallas Tamales", "slug": "south-dallas-tamales"},
                    "subscription_tiers": {
                        "code": "starter",
                        "name": "Starter",
                        "monthly_price_cents": 1900,
                        "perks_summary": "Analytics enabled",
                        "analytics_enabled": True,
                        "priority_visibility": True,
                        "premium_storefront": False,
                    },
                },
            ],
            insert_results=[],
        )

        with patch("app.services.subscriptions.get_supabase_client", return_value=fake_supabase):
            subscription = get_my_seller_subscription(
                CurrentUser(id="user-1", email="seller@example.com", access_token="seller-token")
            )

        self.assertEqual(subscription.seller_id, "seller-1")
        self.assertEqual(subscription.tier_name, "Starter")
        self.assertEqual(subscription.perks_summary, "Analytics enabled")
        self.assertTrue(subscription.priority_visibility)

    def test_reads_public_seller_subscription_by_slug(self):
        fake_supabase = _FakeSupabase(
            select_results=[
                {"id": "seller-1", "display_name": "South Dallas Tamales", "slug": "south-dallas-tamales"},
                {
                    "id": "subscription-1",
                    "seller_id": "seller-1",
                    "tier_id": "tier-1",
                    "started_at": "2026-04-07T16:05:00Z",
                    "ended_at": None,
                    "is_active": True,
                    "created_at": "2026-04-07T16:05:00Z",
                    "seller_profiles": {"display_name": "South Dallas Tamales", "slug": "south-dallas-tamales"},
                    "subscription_tiers": {
                        "code": "premium",
                        "name": "Premium",
                        "monthly_price_cents": 4900,
                        "perks_summary": "Premium storefront enabled",
                        "analytics_enabled": True,
                        "priority_visibility": True,
                        "premium_storefront": True,
                    },
                },
            ],
            insert_results=[],
        )

        with patch("app.services.subscriptions.get_supabase_client", return_value=fake_supabase):
            subscription = get_seller_subscription_by_slug("south-dallas-tamales")

        self.assertEqual(subscription.tier_code, "premium")
        self.assertTrue(subscription.premium_storefront)

    def test_lists_subscription_events(self):
        fake_supabase = _FakeSupabase(
            select_results=[
                [
                    {
                        "id": "event-1",
                        "seller_id": "seller-1",
                        "seller_subscription_id": "subscription-1",
                        "actor_user_id": "admin-user-1",
                        "action": "upgrade",
                        "reason_code": "manual_upgrade",
                        "from_tier_id": "tier-0",
                        "to_tier_id": "tier-1",
                        "note": None,
                        "created_at": "2026-04-07T16:05:00Z",
                        "seller_profiles": {"display_name": "South Dallas Tamales", "slug": "south-dallas-tamales"},
                        "from_tier": {"code": "free", "name": "Free"},
                        "to_tier": {"code": "starter", "name": "Starter"},
                    }
                ],
                [
                    {
                        "id": "admin-user-1",
                        "full_name": "Monetization Admin",
                        "username": "money-admin",
                    }
                ],
            ],
            insert_results=[],
        )

        with patch("app.services.subscriptions.get_supabase_client", return_value=fake_supabase):
            events = list_subscription_events(limit=10)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].action, "upgrade")
        self.assertEqual(events[0].reason_code, "manual_upgrade")
        self.assertEqual(events[0].to_tier_name, "Starter")
        self.assertEqual(events[0].actor_name, "Monetization Admin")


class _FakeSupabase:
    def __init__(self, *, select_results, insert_results):
        self._select_results = list(select_results)
        self._insert_results = list(insert_results)
        self.insert_calls = []
        self.update_calls = []

    def select(self, *args, **kwargs):
        if not self._select_results:
            raise AssertionError("Unexpected select call")
        return self._select_results.pop(0)

    def insert(self, table, payload, *args, **kwargs):
        self.insert_calls.append((table, payload))
        if table == "seller_subscription_events":
            return [payload]
        if table == "notification_deliveries":
            return [payload]
        if not self._insert_results:
            raise AssertionError("Unexpected insert call")
        return self._insert_results.pop(0)

    def update(self, table, payload, *args, **kwargs):
        self.update_calls.append((table, payload))
        return []


if __name__ == "__main__":
    unittest.main()
