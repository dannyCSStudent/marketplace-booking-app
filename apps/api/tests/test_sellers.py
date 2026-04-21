import unittest
from unittest.mock import patch

from app.routers.admin import read_seller_trust_interventions
from app.routers.sellers import (
    read_seller_by_id,
    read_seller_listings_by_slug,
    read_seller_listing_summary_by_slug,
)
from app.schemas.listings import ListingListResponse, ListingRead, SellerListingSummaryRead
from app.schemas.sellers import SellerUpdate
from app.services.sellers import (
    get_my_seller_profile_completion,
    get_seller_by_slug,
    list_seller_trust_interventions,
    update_my_seller,
    search_sellers,
)


class SellerSearchTests(unittest.TestCase):
    def test_searches_sellers_by_slug_or_display_name(self):
        class _Supabase:
            def __init__(self):
                self.select_calls = []

            def select(self, table, **kwargs):
                self.select_calls.append((table, kwargs))
                return [
                    {
                        "id": "seller-1",
                        "display_name": "South Dallas Tamales",
                        "slug": "south-dallas-tamales",
                        "is_verified": True,
                        "city": "Dallas",
                        "state": "TX",
                        "country": "USA",
                    }
                ]

        fake_supabase = _Supabase()

        with patch("app.services.sellers.get_supabase_client", return_value=fake_supabase):
            sellers = search_sellers("tamales", limit=5)

        self.assertEqual(len(sellers), 1)
        self.assertEqual(sellers[0].slug, "south-dallas-tamales")
        self.assertEqual(fake_supabase.select_calls[0][0], "seller_profiles")
        self.assertEqual(
            fake_supabase.select_calls[0][1]["query"]["or"],
            "display_name.ilike.*tamales*,slug.ilike.*tamales*",
        )


class SellerTrustScoreTests(unittest.TestCase):
    def test_builds_seller_trust_score_from_existing_signals(self):
        class _Supabase:
            def select(self, table, **kwargs):
                if table == "seller_profiles":
                    return {
                        "id": "seller-1",
                        "user_id": "user-1",
                        "display_name": "South Dallas Tamales",
                        "slug": "south-dallas-tamales",
                        "bio": "Local tamales and catering.",
                        "is_verified": True,
                        "accepts_custom_orders": True,
                        "average_rating": 4.8,
                        "review_count": 5,
                        "city": "Dallas",
                        "state": "TX",
                        "country": "USA",
                    }

                if table == "reviews":
                    return [
                        {"seller_response": "Thanks!", "is_hidden": False, "created_at": "2026-04-08T12:00:00Z"},
                        {"seller_response": None, "is_hidden": False, "created_at": "2026-04-07T12:00:00Z"},
                        {"seller_response": "Appreciate it", "is_hidden": False, "created_at": "2026-04-06T12:00:00Z"},
                        {"seller_response": None, "is_hidden": False, "created_at": "2026-03-01T12:00:00Z"},
                    ]

                if table == "orders":
                    return [
                        {"status": "completed", "created_at": "2026-04-08T12:00:00Z"},
                        {"status": "completed", "created_at": "2026-04-07T12:00:00Z"},
                        {"status": "canceled", "created_at": "2026-04-06T12:00:00Z"},
                        {"status": "canceled", "created_at": "2026-03-01T12:00:00Z"},
                    ]

                if table == "bookings":
                    return [
                        {"status": "completed", "created_at": "2026-04-08T12:00:00Z"},
                        {"status": "confirmed", "created_at": "2026-04-07T12:00:00Z"},
                        {"status": "confirmed", "created_at": "2026-03-01T12:00:00Z"},
                    ]

                if table == "notification_deliveries":
                    return [
                        {"delivery_status": "sent", "created_at": "2026-04-08T12:00:00Z"},
                        {"delivery_status": "sent", "created_at": "2026-04-07T12:00:00Z"},
                        {"delivery_status": "failed", "created_at": "2026-03-01T12:00:00Z"},
                    ]

                raise AssertionError(f"Unexpected select table: {table}")

        fake_supabase = _Supabase()

        with patch("app.services.sellers.get_supabase_client", return_value=fake_supabase):
            seller = get_seller_by_slug("south-dallas-tamales")

        self.assertIsNotNone(seller.trust_score)
        self.assertEqual(seller.trust_score.label, "Strong seller")
        self.assertEqual(seller.trust_score.risk_level, "low")
        self.assertEqual(seller.trust_score.trend_direction, "improving")
        self.assertGreater(seller.trust_score.trend_delta, 0)
        self.assertGreaterEqual(seller.trust_score.score, 75)
        self.assertEqual(seller.trust_score.review_count, 4)
        self.assertEqual(seller.trust_score.completed_transactions, 3)
        self.assertEqual(seller.trust_score.total_transactions, 7)
        self.assertIn("Seller response coverage could be stronger", seller.trust_score.risk_reasons)
        self.assertIn("Completion rate is slipping", seller.trust_score.risk_reasons)
        self.assertIn("Delivery reliability needs attention", seller.trust_score.risk_reasons)

    def test_lists_seller_trust_interventions_from_worsening_sellers(self):
        class _Supabase:
            def __init__(self):
                self.insert_calls = 0
                self.insert_payloads = []

            def select(self, table, **kwargs):
                if table == "seller_profiles":
                    return [
                        {
                            "id": "seller-critical",
                            "user_id": "user-critical",
                            "display_name": "South Dallas Tamales",
                            "slug": "south-dallas-tamales",
                            "bio": "Local tamales and catering.",
                            "is_verified": False,
                            "accepts_custom_orders": True,
                            "average_rating": 1.4,
                            "review_count": 20,
                            "city": "Dallas",
                            "state": "TX",
                            "country": "USA",
                            "updated_at": "2026-04-08T12:00:00Z",
                        }
                    ]

                if table == "reviews":
                    return [
                        {"seller_response": None, "is_hidden": True, "created_at": "2026-04-08T12:00:00Z"},
                        {"seller_response": None, "is_hidden": False, "created_at": "2026-04-07T12:00:00Z"},
                        {"seller_response": "Thanks!", "is_hidden": False, "created_at": "2026-03-08T12:00:00Z"},
                        {"seller_response": "Appreciate it", "is_hidden": False, "created_at": "2026-03-07T12:00:00Z"},
                    ]

                if table == "orders":
                    return [
                        {"status": "canceled", "created_at": "2026-04-08T12:00:00Z"},
                        {"status": "canceled", "created_at": "2026-04-07T12:00:00Z"},
                        {"status": "completed", "created_at": "2026-03-08T12:00:00Z"},
                        {"status": "completed", "created_at": "2026-03-07T12:00:00Z"},
                    ]

                if table == "bookings":
                    return [
                        {"status": "canceled", "created_at": "2026-04-08T12:00:00Z"},
                        {"status": "canceled", "created_at": "2026-04-07T12:00:00Z"},
                        {"status": "completed", "created_at": "2026-03-08T12:00:00Z"},
                        {"status": "completed", "created_at": "2026-03-07T12:00:00Z"},
                    ]

                if table == "notification_deliveries":
                    return [
                        {"delivery_status": "failed", "created_at": "2026-04-08T12:00:00Z"},
                        {"delivery_status": "failed", "created_at": "2026-04-07T12:00:00Z"},
                        {"delivery_status": "sent", "created_at": "2026-03-08T12:00:00Z"},
                        {"delivery_status": "sent", "created_at": "2026-03-07T12:00:00Z"},
                    ]

                if table == "profiles":
                    return [
                        {
                            "id": "trust-admin",
                            "email_notifications_enabled": True,
                            "push_notifications_enabled": True,
                        }
                    ]

                raise AssertionError(f"Unexpected select table: {table}")

            def insert(self, table, payload, **kwargs):
                if table != "notification_deliveries":
                    raise AssertionError(f"Unexpected insert table: {table}")
                self.insert_calls += 1
                self.insert_payloads.append(payload)
                return payload

        fake_supabase = _Supabase()

        with patch("app.services.sellers.get_supabase_client", return_value=fake_supabase):
            interventions = list_seller_trust_interventions(limit=10)

        self.assertEqual(len(interventions), 1)
        intervention = interventions[0]
        self.assertEqual(intervention.seller.id, "seller-critical")
        self.assertEqual(intervention.risk_level, "elevated")
        self.assertEqual(intervention.trend_direction, "worsening")
        self.assertEqual(intervention.intervention_priority, "high")
        self.assertIn("Trust score", intervention.intervention_reason)
        self.assertEqual(intervention.intervention_lane, "seller_trust_intervention")

    def test_queues_admin_notifications_for_new_trust_interventions(self):
        class _Supabase:
            def __init__(self):
                self.insert_calls = 0
                self.insert_payloads = []

            def select(self, table, **kwargs):
                if table == "seller_profiles":
                    return [
                        {
                            "id": "seller-critical",
                            "user_id": "user-critical",
                            "display_name": "South Dallas Tamales",
                            "slug": "south-dallas-tamales",
                            "bio": "Local tamales and catering.",
                            "is_verified": False,
                            "accepts_custom_orders": True,
                            "average_rating": 1.4,
                            "review_count": 20,
                            "city": "Dallas",
                            "state": "TX",
                            "country": "USA",
                            "updated_at": "2026-04-08T12:00:00Z",
                        }
                    ]

                if table == "reviews":
                    return [
                        {"seller_response": None, "is_hidden": True, "created_at": "2026-04-08T12:00:00Z"},
                        {"seller_response": None, "is_hidden": False, "created_at": "2026-04-07T12:00:00Z"},
                        {"seller_response": "Thanks!", "is_hidden": False, "created_at": "2026-03-08T12:00:00Z"},
                        {"seller_response": "Appreciate it", "is_hidden": False, "created_at": "2026-03-07T12:00:00Z"},
                    ]

                if table == "orders":
                    return [
                        {"status": "canceled", "created_at": "2026-04-08T12:00:00Z"},
                        {"status": "canceled", "created_at": "2026-04-07T12:00:00Z"},
                        {"status": "completed", "created_at": "2026-03-08T12:00:00Z"},
                        {"status": "completed", "created_at": "2026-03-07T12:00:00Z"},
                    ]

                if table == "bookings":
                    return [
                        {"status": "canceled", "created_at": "2026-04-08T12:00:00Z"},
                        {"status": "canceled", "created_at": "2026-04-07T12:00:00Z"},
                        {"status": "completed", "created_at": "2026-03-08T12:00:00Z"},
                        {"status": "completed", "created_at": "2026-03-07T12:00:00Z"},
                    ]

                if table == "profiles":
                    return [
                        {
                            "id": "trust-admin",
                            "email_notifications_enabled": True,
                            "push_notifications_enabled": True,
                        }
                    ]

                if table == "notification_deliveries":
                    return []

                raise AssertionError(f"Unexpected select table: {table}")

            def insert(self, table, payload, **kwargs):
                if table != "notification_deliveries":
                    raise AssertionError(f"Unexpected insert table: {table}")
                self.insert_calls += 1
                self.insert_payloads.append(payload)
                return payload

        fake_supabase = _Supabase()

        with (
            patch("app.services.sellers.get_supabase_client", return_value=fake_supabase),
            patch(
                "app.services.sellers.get_settings",
                return_value=type(
                    "Settings",
                    (),
                    {
                        "admin_user_ids": ["trust-admin"],
                        "admin_user_roles": {"trust-admin": "trust"},
                    },
                )(),
            ),
            patch("app.services.sellers.process_notification_delivery_rows") as mocked_dispatch,
        ):
            interventions = list_seller_trust_interventions(limit=10)

        self.assertEqual(len(interventions), 1)
        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(len(fake_supabase.insert_payloads[0]), 2)
        self.assertEqual(
            {row["channel"] for row in fake_supabase.insert_payloads[0]},
            {"email", "push"},
        )
        self.assertEqual(fake_supabase.insert_payloads[0][0]["payload"]["alert_type"], "seller_trust_intervention")
        mocked_dispatch.assert_called_once_with(fake_supabase.insert_payloads[0])


class SellerRouteTests(unittest.TestCase):
    def test_reads_seller_by_id(self):
        with patch(
            "app.routers.sellers.get_seller_by_id",
            return_value={
                "id": "seller-1",
                "user_id": "user-1",
                "display_name": "South Dallas Tamales",
                "slug": "south-dallas-tamales",
                "bio": "Local tamales and catering.",
                "is_verified": True,
                "accepts_custom_orders": True,
                "average_rating": 4.9,
                "review_count": 12,
                "trust_score": {
                    "score": 88,
                    "label": "Strong seller",
                    "summary": "Trust score blends review quality, seller response, completed transactions, and delivery reliability.",
                },
                "city": "Dallas",
                "state": "TX",
                "country": "USA",
            },
        ) as mocked_get_seller:
            response = read_seller_by_id("seller-1")

        self.assertEqual(response["slug"], "south-dallas-tamales")
        self.assertIn("trust_score", response)
        mocked_get_seller.assert_called_once_with("seller-1")

    def test_reads_seller_listings_by_slug(self):
        with patch(
            "app.routers.sellers.list_public_listings_by_seller_slug",
            return_value=ListingListResponse(
                items=[
                    ListingRead(
                        id="listing-1",
                        seller_id="seller-1",
                        title="Tamales by the Dozen",
                        slug="tamales-by-the-dozen",
                        type="product",
                        status="active",
                        created_at="2025-01-01T00:00:00Z",
                        updated_at="2025-01-01T00:00:00Z",
                    )
                ],
                total=1,
            ),
        ) as mocked_listings:
            response = read_seller_listings_by_slug(
                "south-dallas-tamales",
                query=None,
                category=None,
                type=None,
                limit=None,
                offset=None,
            )

        self.assertEqual(response.total, 1)
        self.assertEqual(response.items[0].slug, "tamales-by-the-dozen")
        mocked_listings.assert_called_once()

    def test_reads_seller_listing_summary_by_slug(self):
        with patch(
            "app.routers.sellers.get_seller_listing_summary_by_slug",
            return_value=SellerListingSummaryRead(
                seller_id="seller-1",
                total=5,
                product_count=2,
                service_count=2,
                hybrid_count=1,
                active_count=4,
                draft_count=1,
                promoted_count=1,
                available_today_count=3,
                quick_booking_count=2,
                local_only_count=4,
                price_surface_cents=12500,
            ),
        ) as mocked_summary:
            response = read_seller_listing_summary_by_slug("south-dallas-tamales")

        self.assertEqual(response.total, 5)
        self.assertEqual(response.product_count, 2)
        self.assertEqual(response.price_surface_cents, 12500)
        mocked_summary.assert_called_once_with("south-dallas-tamales")

    def test_reads_seller_trust_interventions(self):
        with patch(
            "app.routers.admin.list_seller_trust_interventions",
            return_value=[
                    {
                        "seller": {
                            "id": "seller-critical",
                            "user_id": "user-critical",
                            "display_name": "South Dallas Tamales",
                            "slug": "south-dallas-tamales",
                            "bio": "Local tamales and catering.",
                            "is_verified": False,
                            "accepts_custom_orders": True,
                            "average_rating": 3.1,
                            "review_count": 8,
                            "city": "Dallas",
                            "state": "TX",
                            "country": "USA",
                            "trust_score": {
                                "score": 42,
                                "label": "Needs attention",
                                "summary": "Trust score blends review quality, seller response, completed transactions, and delivery reliability.",
                                "risk_level": "critical",
                                "trend_direction": "worsening",
                                "trend_summary": "Seller trust fell by 11 points versus the prior 30-day window.",
                                "trend_delta": -11,
                                "risk_reasons": ["Completion rate is slipping"],
                                "review_quality_score": 12,
                                "response_rate_score": 4,
                                "completion_score": 8,
                                "delivery_reliability_score": 10,
                                "verified_bonus": 0,
                                "review_count": 8,
                                "response_rate": 0.5,
                                "completion_rate": 0.4,
                                "delivery_success_rate": 0.4,
                                "hidden_review_count": 1,
                                "completed_transactions": 3,
                                "total_transactions": 8,
                            },
                        },
                        "risk_level": "critical",
                        "trend_direction": "worsening",
                        "trend_summary": "Seller trust fell by 11 points versus the prior 30-day window.",
                        "intervention_reason": "Trust score blends review quality, seller response, completed transactions, and delivery reliability. Completion rate is slipping",
                        "intervention_priority": "high",
                        "intervention_lane": "seller_trust_intervention",
                    }
                ],
        ) as mocked_interventions:
            response = read_seller_trust_interventions(limit=20, current_user=None)

        self.assertEqual(response[0]["seller"]["slug"], "south-dallas-tamales")
        self.assertEqual(response[0]["intervention_lane"], "seller_trust_intervention")
        mocked_interventions.assert_called_once_with(limit=20)

    def test_builds_my_seller_profile_completion_from_profile_fields(self):
        class _Supabase:
            def select(self, table, **kwargs):
                if table != "seller_profiles":
                    raise AssertionError(f"Unexpected select table: {table}")

                return {
                    "id": "seller-complete",
                    "user_id": "user-complete",
                    "display_name": "Northside Bakes",
                    "slug": "northside-bakes",
                    "bio": "Fresh baked goods.",
                    "is_verified": False,
                    "accepts_custom_orders": True,
                    "average_rating": 4.9,
                    "review_count": 11,
                    "city": "Austin",
                    "state": "TX",
                    "country": "USA",
                }

        fake_supabase = _Supabase()
        current_user = type("CurrentUser", (), {"id": "user-complete", "access_token": "token-1"})()

        with patch("app.services.sellers.get_supabase_client", return_value=fake_supabase):
            completion = get_my_seller_profile_completion(current_user)

        self.assertEqual(completion.seller_id, "seller-complete")
        self.assertEqual(completion.seller_slug, "northside-bakes")
        self.assertEqual(completion.total_checks, 3)
        self.assertEqual(completion.completed_checks, 2)
        self.assertEqual(completion.missing_checks, 1)
        self.assertEqual(completion.completion_percent, 67)
        self.assertEqual(completion.missing_fields, ["Verification"])
        self.assertFalse(completion.is_complete)
        self.assertIn("verification", completion.summary.lower())

    def test_update_my_seller_queues_profile_completion_notifications_when_incomplete(self):
        class _Supabase:
            def __init__(self):
                self.update_calls = []

            def select(self, table, **kwargs):
                if table not in {"reviews", "orders", "bookings", "notification_deliveries"}:
                    raise AssertionError(f"Unexpected select table: {table}")

                return []

            def update(self, table, payload, **kwargs):
                if table != "seller_profiles":
                    raise AssertionError(f"Unexpected update table: {table}")

                self.update_calls.append((payload, kwargs))
                return [
                    {
                        "id": "seller-update",
                        "user_id": "user-update",
                        "display_name": "Northside Bakes",
                        "slug": "northside-bakes",
                        "bio": "Fresh baked goods.",
                        "is_verified": False,
                        "accepts_custom_orders": True,
                        "average_rating": 4.9,
                        "review_count": 11,
                        "city": "Austin",
                        "state": "TX",
                        "country": "USA",
                    }
                ]

        fake_supabase = _Supabase()
        current_user = type("CurrentUser", (), {"id": "user-update", "access_token": "token-1"})()

        with (
            patch("app.services.sellers.get_supabase_client", return_value=fake_supabase),
            patch("app.services.sellers.queue_seller_profile_completion_notifications") as mocked_queue,
        ):
            seller = update_my_seller(current_user, SellerUpdate(bio="Fresh baked goods."))

        self.assertEqual(seller.id, "seller-update")
        mocked_queue.assert_called_once()
        queued_seller, queued_completion = mocked_queue.call_args.args
        self.assertEqual(queued_seller["id"], "seller-update")
        self.assertFalse(queued_completion["is_complete"])
        self.assertIn("Verification", queued_completion["missing_fields"])

    def test_reads_paged_seller_listings_by_slug(self):
        with patch(
            "app.routers.sellers.list_public_listings_by_seller_slug",
            return_value=ListingListResponse(items=[], total=0, limit=12, offset=24),
        ) as mocked:
            response = read_seller_listings_by_slug(
                "south-dallas-tamales",
                query=None,
                category=None,
                type=None,
                limit=12,
                offset=24,
            )

        self.assertEqual(response.limit, 12)
        self.assertEqual(response.offset, 24)
        mocked.assert_called_once()
        call = mocked.call_args
        self.assertIsNotNone(call)
        args, kwargs = call
        self.assertEqual(args[0], "south-dallas-tamales")
        self.assertEqual(args[1].limit, 12)
        self.assertEqual(args[1].offset, 24)


if __name__ == "__main__":
    unittest.main()
