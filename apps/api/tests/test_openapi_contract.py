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
            "/sellers/{slug}",
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
            "/notifications/admin/bulk-retry",
            "/notifications/admin/{delivery_id}/retry",
            "/notifications/{delivery_id}/retry",
            "/notifications/bulk-retry",
            "/admin/users",
        }

        self.assertTrue(expected_paths.issubset(paths.keys()))

    def test_core_response_schemas_exist(self):
        schema = app.openapi()
        components = schema["components"]["schemas"]

        for schema_name in [
            "CategoryRead",
            "ProfileRead",
            "SellerRead",
            "ListingRead",
            "ListingListResponse",
            "OrderRead",
            "OrderBulkStatusUpdateResult",
            "BookingRead",
            "BookingBulkStatusUpdateResult",
            "NotificationDeliveryRead",
            "NotificationDeliveryBulkRetryResult",
            "AdminUserRead",
        ]:
            self.assertIn(schema_name, components)

    def test_profile_schema_exposes_notification_device_fields(self):
        schema = app.openapi()
        components = schema["components"]["schemas"]

        profile_read = components["ProfileRead"]["properties"]
        profile_update = components["ProfileUpdate"]["properties"]

        self.assertIn("expo_push_token", profile_read)
        self.assertIn("expo_push_token", profile_update)

    def test_marketplace_routes_have_expected_methods(self):
        schema = app.openapi()
        paths = schema["paths"]

        self.assertIn("get", paths["/listings"])
        self.assertIn("get", paths["/listings/admin"])
        self.assertIn("post", paths["/listings"])
        self.assertIn("patch", paths["/orders/{order_id}"])
        self.assertIn("post", paths["/orders/bulk-status"])
        self.assertIn("patch", paths["/bookings/{booking_id}"])
        self.assertIn("post", paths["/bookings/bulk-status"])
        self.assertIn("post", paths["/notifications/bulk-retry"])
        self.assertIn("get", paths["/notifications/admin"])
        self.assertIn("post", paths["/notifications/admin/bulk-retry"])
        self.assertIn("post", paths["/notifications/admin/{delivery_id}/retry"])
        self.assertIn("get", paths["/admin/users"])

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
