import unittest

from app.main import app


class OpenAPIContractTests(unittest.TestCase):
    def test_core_paths_exist(self):
        schema = app.openapi()
        paths = schema["paths"]

        expected_paths = {
            "/categories",
            "/profiles/me",
            "/sellers",
            "/sellers/me",
            "/sellers/by-id/{seller_id}",
            "/sellers/{slug}",
            "/sellers/{slug}/listings/summary",
            "/sellers/{slug}/listings",
            "/sellers/{slug}/reviews",
            "/sellers/{slug}/subscription",
            "/listings",
            "/listings/me",
            "/listings/ai-assist",
            "/listings/admin",
            "/listings/{listing_id}",
            "/listings/{listing_id}/price-insights",
            "/orders",
            "/orders/me",
            "/orders/seller",
            "/orders/{order_id}",
            "/orders/bulk-status",
            "/bookings",
            "/bookings/me",
            "/bookings/seller",
            "/bookings/{booking_id}",
            "/bookings/bulk-status",
            "/notifications/me",
            "/notifications/admin",
            "/notifications/admin/summary",
            "/notifications/admin/worker-health",
            "/notifications/admin/bulk-retry",
            "/notifications/admin/{delivery_id}/retry",
            "/notifications/admin/delivery-failures/summaries",
            "/notifications/admin/delivery-failures/events",
            "/notifications/admin/delivery-failures/{failed_delivery_id}/acknowledge",
            "/notifications/admin/inventory-alerts/summaries",
            "/notifications/admin/inventory-alerts/events",
            "/notifications/admin/inventory-alerts/{seller_id}/{listing_id}/acknowledge",
            "/notifications/admin/subscription-downgrades/sellers",
            "/notifications/admin/subscription-downgrades/events",
            "/notifications/admin/subscription-downgrades/{seller_id}/acknowledge",
            "/notifications/{delivery_id}/retry",
            "/notifications/bulk-retry",
            "/admin/users",
            "/admin/seller-trust/interventions",
        }

        self.assertTrue(expected_paths.issubset(paths.keys()))

    def test_core_response_schemas_exist(self):
        schema = app.openapi()
        components = schema["components"]["schemas"]

        for schema_name in [
            "CategoryRead",
            "ProfileRead",
            "SellerRead",
            "SellerTrustScoreRead",
            "SellerTrustInterventionRead",
            "SellerListingSummaryRead",
            "ListingRead",
            "ListingListResponse",
            "OrderRead",
            "OrderBulkStatusUpdateResult",
            "BookingRead",
            "BookingBulkStatusUpdateResult",
            "NotificationDeliveryRead",
            "NotificationDeliverySummaryRead",
            "NotificationWorkerHealthRead",
            "NotificationDeliveryBulkRetryResult",
            "DeliveryFailureSummaryRead",
            "DeliveryFailureEventRead",
            "InventoryAlertSummaryRead",
            "InventoryAlertEventRead",
            "SubscriptionDowngradeSellerSummaryRead",
            "SubscriptionDowngradeEventRead",
            "AdminUserRead",
        ]:
            self.assertIn(schema_name, components)

    def test_profile_schema_exposes_notification_device_fields(self):
        schema = app.openapi()
        components = schema["components"]["schemas"]

        profile_read = components["ProfileRead"]["properties"]
        profile_update = components["ProfileUpdate"]["properties"]
        seller_read = components["SellerRead"]["properties"]

        self.assertIn("expo_push_token", profile_read)
        self.assertIn("expo_push_token", profile_update)
        self.assertIn("admin_monetization_preferences", profile_read)
        self.assertIn("admin_monetization_preferences", profile_update)
        self.assertIn("admin_delivery_ops_preferences", profile_read)
        self.assertIn("admin_delivery_ops_preferences", profile_update)
        self.assertIn("trust_score", seller_read)

    def test_marketplace_routes_have_expected_methods(self):
        schema = app.openapi()
        paths = schema["paths"]

        self.assertIn("get", paths["/listings"])
        self.assertIn("get", paths["/listings/admin"])
        self.assertIn("post", paths["/listings"])
        self.assertIn("get", paths["/sellers/by-id/{seller_id}"])
        self.assertIn("get", paths["/sellers/{slug}/listings/summary"])
        self.assertIn("get", paths["/sellers/{slug}/listings"])
        self.assertIn("patch", paths["/orders/{order_id}"])
        self.assertIn("post", paths["/orders/bulk-status"])
        self.assertIn("patch", paths["/bookings/{booking_id}"])
        self.assertIn("post", paths["/bookings/bulk-status"])
        self.assertIn("post", paths["/notifications/bulk-retry"])
        self.assertIn("get", paths["/notifications/admin"])
        self.assertIn("get", paths["/notifications/admin/summary"])
        self.assertIn("get", paths["/notifications/admin/worker-health"])
        self.assertIn("post", paths["/notifications/admin/bulk-retry"])
        self.assertIn("post", paths["/notifications/admin/{delivery_id}/retry"])
        self.assertIn("get", paths["/notifications/admin/delivery-failures/summaries"])
        self.assertIn("get", paths["/notifications/admin/delivery-failures/events"])
        self.assertIn("post", paths["/notifications/admin/delivery-failures/{failed_delivery_id}/acknowledge"])
        self.assertIn("delete", paths["/notifications/admin/delivery-failures/{failed_delivery_id}/acknowledge"])
        self.assertIn("get", paths["/notifications/admin/inventory-alerts/summaries"])
        self.assertIn("get", paths["/notifications/admin/inventory-alerts/events"])
        self.assertIn("post", paths["/notifications/admin/inventory-alerts/{seller_id}/{listing_id}/acknowledge"])
        self.assertIn("delete", paths["/notifications/admin/inventory-alerts/{seller_id}/{listing_id}/acknowledge"])
        self.assertIn("get", paths["/notifications/admin/subscription-downgrades/sellers"])
        self.assertIn("get", paths["/notifications/admin/subscription-downgrades/events"])
        self.assertIn("post", paths["/notifications/admin/subscription-downgrades/{seller_id}/acknowledge"])
        self.assertIn("delete", paths["/notifications/admin/subscription-downgrades/{seller_id}/acknowledge"])
        self.assertIn("get", paths["/admin/users"])
        self.assertIn("get", paths["/admin/seller-trust/interventions"])

    def test_listing_schema_exposes_real_contract_fields(self):
        schema = app.openapi()
        components = schema["components"]["schemas"]

        listing_read = components["ListingRead"]["properties"]
        listing_create = components["ListingCreate"]["properties"]
        price_insight = components["ListingPriceInsight"]["properties"]

        for field_name in [
            "category",
            "slug",
            "status",
            "inventory_count",
            "requires_booking",
            "duration_minutes",
            "is_local_only",
            "pickup_enabled",
            "meetup_enabled",
            "delivery_enabled",
            "shipping_enabled",
            "lead_time_hours",
            "created_at",
            "updated_at",
            "last_operating_adjustment_at",
            "last_operating_adjustment_summary",
            "recent_transaction_count",
            "is_new_listing",
            "last_pricing_comparison_scope",
        ]:
            self.assertIn(field_name, listing_read)

        for field_name in [
            "slug",
            "status",
            "is_local_only",
            "lead_time_hours",
        ]:
            self.assertIn(field_name, listing_create)

        self.assertIn("comparison_scope", price_insight)


if __name__ == "__main__":
    unittest.main()
