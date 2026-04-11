import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.core.supabase import SupabaseError
from app.dependencies.auth import CurrentUser
from app.schemas.reviews import (
    ReviewCreate,
    ReviewAnomalyRead,
    ReviewModerationItem,
    ReviewAnomalySellerSummaryRead,
    ReviewReportCreate,
    ReviewReportStatusUpdate,
    ReviewSellerResponseUpdate,
    ReviewVisibilityUpdate,
    ReviewRead,
)
from app.services.reviews import (
    acknowledge_review_anomaly,
    create_review,
    create_review_report,
    clear_review_anomaly_acknowledgement,
    generate_review_response_ai_assist,
    get_my_review_lookup,
    _queue_review_anomaly_notifications,
    list_review_anomalies,
    list_review_anomaly_seller_summaries,
    list_review_reports,
    update_review_seller_response,
    update_review_report_status,
    update_review_visibility,
)


BUYER_USER = CurrentUser(id="buyer-user-id", email="buyer@example.com", access_token="buyer-token")
SELLER_USER = CurrentUser(id="seller-user-id", email="seller@example.com", access_token="seller-token")


class ReviewCreationTests(unittest.TestCase):
    def test_buyer_can_review_completed_order_once(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                {
                    "id": "order-1",
                    "buyer_id": BUYER_USER.id,
                    "seller_id": "seller-profile-id",
                    "status": "completed",
                },
                SupabaseError(406, "No review yet"),
                [{"rating": 5}],
            ],
            insert_result=[
                {
                    "id": "review-1",
                    "rating": 5,
                    "comment": "Great order experience.",
                    "created_at": "2026-04-05T12:00:00+00:00",
                }
            ],
        )

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            review = create_review(
                BUYER_USER,
                ReviewCreate(
                    order_id="order-1",
                    rating=5,
                    comment="Great order experience.",
                ),
            )

        self.assertEqual(review.rating, 5)
        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(fake_supabase.update_calls, 1)
        self.assertEqual(fake_supabase.updated_payload["review_count"], 1)
        self.assertEqual(fake_supabase.updated_payload["average_rating"], 5.0)

    def test_rejects_review_before_completion(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                {
                    "id": "booking-1",
                    "buyer_id": BUYER_USER.id,
                    "seller_id": "seller-profile-id",
                    "status": "confirmed",
                }
            ],
        )

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            with self.assertRaises(HTTPException) as context:
                create_review(
                    BUYER_USER,
                    ReviewCreate(
                        booking_id="booking-1",
                        rating=4,
                        comment="Too early",
                    ),
                )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("only allowed after a booking is completed", context.exception.detail)
        self.assertEqual(fake_supabase.insert_calls, 0)

    def test_rejects_duplicate_transaction_review(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                {
                    "id": "order-1",
                    "buyer_id": BUYER_USER.id,
                    "seller_id": "seller-profile-id",
                    "status": "completed",
                },
                {
                    "id": "review-1",
                    "rating": 5,
                    "comment": "Already reviewed.",
                    "created_at": "2026-04-05T12:00:00+00:00",
                },
            ],
        )

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            with self.assertRaises(HTTPException) as context:
                create_review(
                    BUYER_USER,
                    ReviewCreate(
                        order_id="order-1",
                        rating=5,
                    ),
                )

        self.assertEqual(context.exception.status_code, 409)
        self.assertIn("already exists", context.exception.detail)
        self.assertEqual(fake_supabase.insert_calls, 0)


class ReviewLookupTests(unittest.TestCase):
    def test_lookup_returns_review_for_transaction(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                {
                    "id": "review-1",
                    "rating": 4,
                    "comment": "Solid experience.",
                    "created_at": "2026-04-05T12:00:00+00:00",
                }
            ],
        )

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            result = get_my_review_lookup(BUYER_USER, order_id="order-1")

        self.assertIsNotNone(result.review)
        self.assertEqual(result.review.rating, 4)


class ReviewSellerResponseTests(unittest.TestCase):
    def test_seller_can_save_review_response(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                {"id": "seller-profile-id"},
            ],
            update_result=[
                {
                    "id": "review-1",
                    "rating": 5,
                    "comment": "Great service.",
                    "seller_response": "Thank you for the order.",
                    "seller_responded_at": "2026-04-05T13:00:00+00:00",
                    "created_at": "2026-04-05T12:00:00+00:00",
                }
            ],
        )

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            review = update_review_seller_response(
                SELLER_USER,
                "review-1",
                ReviewSellerResponseUpdate(seller_response="Thank you for the order."),
            )

        self.assertEqual(review.seller_response, "Thank you for the order.")
        self.assertEqual(fake_supabase.update_calls, 1)

    def test_seller_can_generate_review_response_suggestion(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                {"id": "seller-profile-id"},
                {
                    "id": "review-1",
                    "rating": 2,
                    "comment": "The order arrived late, but the food was still good.",
                    "seller_response": None,
                    "seller_responded_at": None,
                },
            ],
        )

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            result = generate_review_response_ai_assist(SELLER_USER, "review-1")

        self.assertEqual(result.review_id, "review-1")
        self.assertIn("sorry this missed the mark", result.suggestion.suggested_response.lower())
        self.assertIn("recovery-focused", result.suggestion.summary.lower())

    def test_missing_seller_profile_blocks_review_response(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[SupabaseError(406, "No seller profile")],
        )

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            with self.assertRaises(HTTPException) as context:
                update_review_seller_response(
                    BUYER_USER,
                    "review-1",
                    ReviewSellerResponseUpdate(seller_response="No access"),
                )

        self.assertEqual(context.exception.status_code, 404)
        self.assertIn("Seller profile not found", context.exception.detail)


class ReviewReportTests(unittest.TestCase):
    def test_buyer_can_report_review_once(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                {"id": "review-1"},
            ],
            insert_result=[
                {
                    "id": "report-1",
                    "review_id": "review-1",
                    "reporter_id": BUYER_USER.id,
                    "reason": "inaccurate_or_abusive",
                    "notes": "Reported from test.",
                    "status": "open",
                    "created_at": "2026-04-05T14:00:00+00:00",
                }
            ],
        )

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            report = create_review_report(
                BUYER_USER,
                "review-1",
                ReviewReportCreate(reason="inaccurate_or_abusive", notes="Reported from test."),
            )

        self.assertEqual(report.review_id, "review-1")
        self.assertEqual(report.status, "open")
        self.assertEqual(fake_supabase.insert_calls, 2)

    def test_duplicate_review_report_is_blocked(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                {"id": "review-1"},
            ],
            insert_error=SupabaseError(409, "duplicate key value violates unique constraint"),
        )

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            with self.assertRaises(HTTPException) as context:
                create_review_report(
                    BUYER_USER,
                    "review-1",
                    ReviewReportCreate(reason="inaccurate_or_abusive"),
                )

        self.assertEqual(context.exception.status_code, 409)
        self.assertIn("already reported", context.exception.detail)

    def test_missing_review_cannot_be_reported(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[SupabaseError(406, "No review found")],
        )

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            with self.assertRaises(HTTPException) as context:
                create_review_report(
                    BUYER_USER,
                    "review-1",
                    ReviewReportCreate(reason="inaccurate_or_abusive"),
                )

        self.assertEqual(context.exception.status_code, 404)
        self.assertIn("Review not found", context.exception.detail)


class ReviewModerationTests(unittest.TestCase):
    def test_list_review_reports_includes_review_context(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                [
                    {
                        "id": "report-1",
                        "review_id": "review-1",
                        "reporter_id": BUYER_USER.id,
                    "reason": "inaccurate_or_abusive",
                    "notes": "Needs review.",
                    "status": "open",
                    "moderator_note": None,
                    "resolution_reason": None,
                    "assignee_user_id": None,
                    "assigned_at": None,
                    "is_escalated": False,
                    "escalated_at": None,
                    "created_at": "2026-04-05T14:00:00+00:00",
                        "reviews": {
                            "id": "review-1",
                            "seller_id": "seller-profile-id",
                            "rating": 2,
                            "comment": "Questionable claim.",
                            "seller_response": None,
                            "seller_responded_at": None,
                            "created_at": "2026-04-05T12:00:00+00:00",
                            "seller_profiles": {
                                "display_name": "Demo Seller",
                                "slug": "demo-seller",
                            },
                        },
                        "review_report_events": [],
                    }
                ]
            ],
        )

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            reports = list_review_reports(status_filter="open")

        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0].seller_id, "seller-profile-id")
        self.assertEqual(reports[0].seller_display_name, "Demo Seller")
        self.assertEqual(reports[0].review.rating, 2)

    def test_update_review_report_status_changes_state(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                {
                    "id": "report-1",
                    "review_id": "review-1",
                    "reporter_id": BUYER_USER.id,
                    "reason": "inaccurate_or_abusive",
                    "notes": "Needs review.",
                    "status": "open",
                    "moderator_note": None,
                    "resolution_reason": None,
                    "assignee_user_id": None,
                    "assigned_at": None,
                    "created_at": "2026-04-05T14:00:00+00:00",
                    "reviews": {
                        "id": "review-1",
                        "seller_id": "seller-profile-id",
                        "rating": 2,
                        "comment": "Questionable claim.",
                        "seller_response": None,
                        "seller_responded_at": None,
                        "created_at": "2026-04-05T12:00:00+00:00",
                        "seller_profiles": {
                            "display_name": "Demo Seller",
                            "slug": "demo-seller",
                        },
                    },
                    "review_report_events": [],
                }
            ],
            update_result=[
                {
                    "id": "report-1",
                    "review_id": "review-1",
                    "reporter_id": BUYER_USER.id,
                    "reason": "inaccurate_or_abusive",
                    "notes": "Needs review.",
                    "status": "resolved",
                    "moderator_note": "Issue resolved after review.",
                    "resolution_reason": "left_public",
                    "assignee_user_id": SELLER_USER.id,
                    "assigned_at": "2026-04-06T09:00:00+00:00",
                    "is_escalated": True,
                    "escalated_at": "2026-04-06T09:15:00+00:00",
                    "created_at": "2026-04-05T14:00:00+00:00",
                    "reviews": {
                        "id": "review-1",
                        "seller_id": "seller-profile-id",
                        "rating": 2,
                        "comment": "Questionable claim.",
                        "seller_response": None,
                        "seller_responded_at": None,
                        "created_at": "2026-04-05T12:00:00+00:00",
                        "seller_profiles": {
                            "display_name": "Demo Seller",
                            "slug": "demo-seller",
                        },
                    },
                    "review_report_events": [],
                }
            ],
        )

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            report = update_review_report_status(
                SELLER_USER,
                "report-1",
                ReviewReportStatusUpdate(
                    status="resolved",
                    moderator_note="Issue resolved after review.",
                    resolution_reason="left_public",
                    assignee_user_id=SELLER_USER.id,
                    is_escalated=True,
                ),
            )

        self.assertEqual(report.status, "resolved")
        self.assertEqual(report.moderator_note, "Issue resolved after review.")
        self.assertEqual(report.resolution_reason, "left_public")
        self.assertEqual(report.assignee_user_id, SELLER_USER.id)
        self.assertTrue(report.is_escalated)
        self.assertEqual(fake_supabase.update_calls, 1)
        self.assertEqual(fake_supabase.insert_calls, 3)

    def test_resolved_review_report_requires_reason(self):
        fake_supabase = _FakeSupabase(select_side_effect=[], update_result=[])

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            with self.assertRaises(HTTPException) as context:
                update_review_report_status(
                    SELLER_USER,
                    "report-1",
                    ReviewReportStatusUpdate(
                        status="resolved",
                        moderator_note="No structured reason supplied.",
                    ),
                )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("require a resolution reason", context.exception.detail)

    def test_update_review_visibility_hides_review(self):
        fake_supabase = _FakeSupabase(
            select_side_effect=[],
            update_result=[
                {
                    "id": "review-1",
                    "rating": 2,
                    "comment": "Questionable claim.",
                    "seller_response": None,
                    "seller_responded_at": None,
                    "is_hidden": True,
                    "hidden_at": "2026-04-06T10:00:00+00:00",
                    "created_at": "2026-04-05T12:00:00+00:00",
                }
            ],
        )

        with patch("app.services.reviews.get_supabase_client", return_value=fake_supabase):
            review = update_review_visibility(
                SELLER_USER,
                "review-1",
                ReviewVisibilityUpdate(is_hidden=True, report_id="report-1"),
            )

        self.assertTrue(review.is_hidden)
        self.assertEqual(fake_supabase.update_calls, 1)
        self.assertEqual(fake_supabase.insert_calls, 1)

    def test_list_review_anomalies_groups_problem_sellers(self):
        reports = [
            ReviewModerationItem(
                id="report-1",
                review_id="review-1",
                reporter_id="buyer-1",
                seller_id="seller-a",
                reason="spam",
                status="open",
                created_at="2026-04-11T10:00:00+00:00",
                review=ReviewRead(
                    id="review-1",
                    rating=1,
                    comment="Bad listing",
                    is_hidden=True,
                    created_at="2026-04-11T09:30:00+00:00",
                ),
                seller_display_name="Alpha Seller",
                seller_slug="alpha-seller",
            ),
            ReviewModerationItem(
                id="report-2",
                review_id="review-2",
                reporter_id="buyer-2",
                seller_id="seller-a",
                reason="inaccurate_or_abusive",
                status="triaged",
                is_escalated=True,
                escalated_at="2026-04-11T11:00:00+00:00",
                created_at="2026-04-11T10:30:00+00:00",
                review=ReviewRead(
                    id="review-2",
                    rating=2,
                    comment="Misleading info",
                    created_at="2026-04-11T10:00:00+00:00",
                ),
                seller_display_name="Alpha Seller",
                seller_slug="alpha-seller",
            ),
            ReviewModerationItem(
                id="report-3",
                review_id="review-3",
                reporter_id="buyer-3",
                seller_id="seller-a",
                reason="spam",
                status="open",
                created_at="2026-04-11T11:30:00+00:00",
                review=ReviewRead(
                    id="review-3",
                    rating=1,
                    comment="Another issue",
                    created_at="2026-04-11T11:00:00+00:00",
                ),
                seller_display_name="Alpha Seller",
                seller_slug="alpha-seller",
            ),
            ReviewModerationItem(
                id="report-4",
                review_id="review-4",
                reporter_id="buyer-4",
                seller_id="seller-b",
                reason="spam",
                status="resolved",
                created_at="2026-04-11T12:00:00+00:00",
                review=ReviewRead(
                    id="review-4",
                    rating=5,
                    comment="Resolved report",
                    created_at="2026-04-11T11:45:00+00:00",
                ),
                seller_display_name="Beta Seller",
                seller_slug="beta-seller",
            ),
        ]

        with patch("app.services.reviews.list_review_reports", return_value=reports):
            anomalies = list_review_anomalies(limit=8)

        self.assertEqual(len(anomalies), 1)
        anomaly = anomalies[0]
        self.assertEqual(anomaly.seller_id, "seller-a")
        self.assertEqual(anomaly.severity, "high")
        self.assertEqual(anomaly.active_report_count, 3)
        self.assertEqual(anomaly.hidden_open_count, 1)
        self.assertIn("Hidden reviews still open", anomaly.reasons)
        self.assertIn("Recent report burst", anomaly.reasons)

    def test_queue_review_anomaly_notifications_dispatches_alerts(self):
        fake_anomaly = [
            ReviewAnomalyRead(
                seller_id="seller-a",
                seller_slug="alpha-seller",
                seller_display_name="Alpha Seller",
                active_report_count=3,
                open_report_count=2,
                escalated_report_count=1,
                hidden_open_count=1,
                recent_report_count=3,
                latest_report_at="2026-04-11T12:00:00+00:00",
                severity="high",
                reasons=["Hidden reviews still open", "Recent report burst"],
            )
        ]
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                [
                    {
                        "id": "admin-1",
                        "email_notifications_enabled": True,
                        "push_notifications_enabled": False,
                    }
                ],
                [],
            ],
            insert_result=[
                {
                    "id": "delivery-1",
                    "recipient_user_id": "admin-1",
                    "transaction_kind": "review",
                    "transaction_id": "seller-a",
                    "event_id": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                    "channel": "email",
                    "delivery_status": "queued",
                    "payload": {
                        "alert_type": "review_anomaly",
                    },
                    "created_at": "2026-04-11T12:01:00+00:00",
                }
            ],
        )

        with (
            patch("app.services.reviews.get_settings") as mock_settings,
            patch("app.services.reviews.get_supabase_client", return_value=fake_supabase),
            patch("app.services.reviews.process_notification_delivery_rows") as mocked_dispatch,
        ):
            mock_settings.return_value.admin_user_ids = ("admin-1",)
            mock_settings.return_value.admin_user_roles = {"admin-1": "trust"}

            _queue_review_anomaly_notifications(fake_anomaly)

        self.assertEqual(fake_supabase.insert_calls, 1)
        self.assertEqual(mocked_dispatch.call_count, 1)
        self.assertEqual(fake_supabase.insert_payloads[0][1][0]["payload"]["alert_type"], "review_anomaly")

    def test_list_review_anomaly_seller_summaries_orders_by_severity_and_volume(self):
        anomalies = [
            ReviewAnomalyRead(
                seller_id="seller-a",
                seller_slug="alpha-seller",
                seller_display_name="Alpha Seller",
                active_report_count=4,
                open_report_count=3,
                escalated_report_count=2,
                hidden_open_count=1,
                recent_report_count=4,
                latest_report_at="2026-04-11T12:00:00+00:00",
                severity="high",
                reasons=["Hidden reviews still open", "Recent report burst"],
            ),
            ReviewAnomalyRead(
                seller_id="seller-b",
                seller_slug="beta-seller",
                seller_display_name="Beta Seller",
                active_report_count=2,
                open_report_count=2,
                escalated_report_count=0,
                hidden_open_count=0,
                recent_report_count=2,
                latest_report_at="2026-04-11T11:00:00+00:00",
                severity="medium",
                reasons=["Repeat seller reporting"],
            ),
        ]

        with patch("app.services.reviews.list_review_anomalies", return_value=anomalies):
            summaries = list_review_anomaly_seller_summaries(limit=6)

        self.assertEqual(len(summaries), 2)
        self.assertEqual(summaries[0].seller_id, "seller-a")
        self.assertEqual(summaries[0].severity, "high")
        self.assertEqual(summaries[1].seller_id, "seller-b")
        self.assertIsInstance(summaries[0], ReviewAnomalySellerSummaryRead)

    def test_admin_can_acknowledge_review_anomalies(self):
        anomaly = ReviewAnomalyRead(
            seller_id="seller-a",
            seller_slug="alpha-seller",
            seller_display_name="Alpha Seller",
            active_report_count=3,
            open_report_count=2,
            escalated_report_count=1,
            hidden_open_count=1,
            recent_report_count=3,
            latest_report_at="2026-04-11T12:00:00+00:00",
            severity="high",
            reasons=["Hidden reviews still open", "Recent report burst"],
        )
        fake_supabase = _FakeSupabase(
            select_side_effect=[
                [
                    {
                        "id": "delivery-1",
                        "recipient_user_id": "admin-1",
                        "transaction_kind": "review",
                        "transaction_id": "seller-a",
                        "event_id": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                        "channel": "email",
                        "delivery_status": "queued",
                        "payload": {
                            "alert_type": "review_anomaly",
                            "seller_id": "seller-a",
                            "seller_slug": "alpha-seller",
                            "seller_display_name": "Alpha Seller",
                            "alert_signature": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                        },
                        "created_at": "2026-04-11T12:01:00+00:00",
                    }
                ],
                [
                    {
                        "id": "delivery-1",
                        "recipient_user_id": "admin-1",
                        "transaction_kind": "review",
                        "transaction_id": "seller-a",
                        "event_id": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                        "channel": "email",
                        "delivery_status": "queued",
                        "payload": {
                            "alert_type": "review_anomaly",
                            "seller_id": "seller-a",
                            "seller_slug": "alpha-seller",
                            "seller_display_name": "Alpha Seller",
                            "alert_signature": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                            "acknowledged_at": "2026-04-11T12:10:00+00:00",
                            "acknowledged_by_user_id": "admin-user-id",
                            "acknowledged_signature": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                        },
                        "created_at": "2026-04-11T12:01:00+00:00",
                    }
                ],
            ],
            update_result=[
                {
                    "id": "delivery-1",
                    "recipient_user_id": "admin-1",
                    "transaction_kind": "review",
                    "transaction_id": "seller-a",
                    "event_id": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                    "channel": "email",
                    "delivery_status": "queued",
                    "payload": {
                        "alert_type": "review_anomaly",
                        "seller_id": "seller-a",
                        "seller_slug": "alpha-seller",
                        "seller_display_name": "Alpha Seller",
                        "alert_signature": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                        "acknowledged_at": "2026-04-11T12:10:00+00:00",
                        "acknowledged_by_user_id": "admin-user-id",
                        "acknowledged_signature": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                    },
                    "created_at": "2026-04-11T12:01:00+00:00",
                }
            ],
        )

        with (
            patch("app.services.reviews.list_review_anomalies", return_value=[anomaly]),
            patch("app.services.reviews.get_supabase_client", return_value=fake_supabase),
        ):
            result = acknowledge_review_anomaly("seller-a", actor_user_id="admin-user-id")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["payload"]["acknowledged_by_user_id"], "admin-user-id")

        fake_supabase_clear = _FakeSupabase(
            select_side_effect=[
                [
                    {
                        "id": "delivery-1",
                        "recipient_user_id": "admin-1",
                        "transaction_kind": "review",
                        "transaction_id": "seller-a",
                        "event_id": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                        "channel": "email",
                        "delivery_status": "queued",
                        "payload": {
                            "alert_type": "review_anomaly",
                            "seller_id": "seller-a",
                            "seller_slug": "alpha-seller",
                            "seller_display_name": "Alpha Seller",
                            "alert_signature": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                            "acknowledged_at": "2026-04-11T12:10:00+00:00",
                            "acknowledged_by_user_id": "admin-user-id",
                            "acknowledged_signature": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                        },
                        "created_at": "2026-04-11T12:01:00+00:00",
                    }
                ],
                [
                    {
                        "id": "delivery-1",
                        "recipient_user_id": "admin-1",
                        "transaction_kind": "review",
                        "transaction_id": "seller-a",
                        "event_id": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                        "channel": "email",
                        "delivery_status": "queued",
                        "payload": {
                            "alert_type": "review_anomaly",
                            "seller_id": "seller-a",
                            "seller_slug": "alpha-seller",
                            "seller_display_name": "Alpha Seller",
                            "alert_signature": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                        },
                        "created_at": "2026-04-11T12:01:00+00:00",
                    }
                ],
            ],
            update_result=[
                {
                    "id": "delivery-1",
                    "recipient_user_id": "admin-1",
                    "transaction_kind": "review",
                    "transaction_id": "seller-a",
                    "event_id": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                    "channel": "email",
                    "delivery_status": "queued",
                    "payload": {
                        "alert_type": "review_anomaly",
                        "seller_id": "seller-a",
                        "seller_slug": "alpha-seller",
                        "seller_display_name": "Alpha Seller",
                        "alert_signature": "review-anomaly:seller-a|high|3|2|1|1|3|2026-04-11T12:00:00+00:00|Hidden reviews still open|Recent report burst",
                    },
                    "created_at": "2026-04-11T12:01:00+00:00",
                }
            ],
        )

        with (
            patch("app.services.reviews.list_review_anomalies", return_value=[anomaly]),
            patch("app.services.reviews.get_supabase_client", return_value=fake_supabase_clear),
        ):
            cleared = clear_review_anomaly_acknowledgement("seller-a", actor_user_id="admin-user-id")

        self.assertEqual(len(cleared), 1)
        self.assertNotIn("acknowledged_signature", cleared[0]["payload"])


class _FakeSupabase:
    def __init__(self, *, select_side_effect, insert_result=None, update_result=None, insert_error=None):
        self._select_side_effect = list(select_side_effect)
        self._insert_result = insert_result or []
        self._update_result = update_result or []
        self._insert_error = insert_error
        self.insert_calls = 0
        self.update_calls = 0
        self.updated_payload = None
        self.insert_payloads = []

    def select(self, *args, **kwargs):
        if not self._select_side_effect:
            raise AssertionError("Unexpected select call")

        next_item = self._select_side_effect.pop(0)
        if isinstance(next_item, Exception):
            raise next_item
        return next_item

    def insert(self, *args, **kwargs):
        self.insert_calls += 1
        if self._insert_error:
            raise self._insert_error
        if args:
            self.insert_payloads.append(args)
        return self._insert_result

    def update(self, table, payload, **kwargs):
        self.update_calls += 1
        self.updated_payload = payload
        return self._update_result or [{**payload}]


if __name__ == "__main__":
    unittest.main()
