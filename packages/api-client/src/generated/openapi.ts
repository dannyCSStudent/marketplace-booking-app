// This file is auto-generated from docs/openapi.json.
// Do not edit it by hand. Run `pnpm --filter api openapi:types`.

export type AdminUserRead = {
    id: string;
    full_name?: string | null;
    username?: string | null;
    email?: string | null;
    role?: string | null;
  };

export type BookingAdminEventRead = {
    id: string;
    actor_user_id: string;
    action: string;
    note?: string | null;
    created_at: string;
  };

export type BookingAdminRead = {
    id: string;
    buyer_id: string;
    seller_id: string;
    listing_id: string;
    status: string;
    scheduled_start: string;
    scheduled_end: string;
    total_cents?: number | null;
    currency?: string;
    platform_fee_cents?: number;
    platform_fee_rate?: string;
    notes?: string | null;
    buyer_browse_context?: string | null;
    seller_response_note?: string | null;
    listing_title?: string | null;
    listing_type?: string | null;
    status_history?: BookingStatusEventRead[];
    admin_note?: string | null;
    admin_handoff_note?: string | null;
    admin_assignee_user_id?: string | null;
    admin_assigned_at?: string | null;
    admin_is_escalated?: boolean;
    admin_escalated_at?: string | null;
    admin_history?: BookingAdminEventRead[];
  };

export type BookingAdminSupportUpdate = {
    admin_note?: string | null;
    admin_handoff_note?: string | null;
    admin_assignee_user_id?: string | null;
    admin_is_escalated?: boolean | null;
  };

export type BookingBulkActionFailure = {
    id: string;
    detail: string;
  };

export type BookingBulkStatusUpdateItem = {
    booking_id: string;
    status: string;
    seller_response_note?: string | null;
  };

export type BookingBulkStatusUpdateRequest = {
    updates: BookingBulkStatusUpdateItem[];
    execution_mode?: string;
  };

export type BookingBulkStatusUpdateResult = {
    succeeded_ids: string[];
    failed: BookingBulkActionFailure[];
  };

export type BookingCreate = {
    seller_id: string;
    listing_id: string;
    scheduled_start: string;
    scheduled_end: string;
    notes?: string | null;
    buyer_browse_context?: string | null;
  };

export type BookingRead = {
    id: string;
    buyer_id: string;
    seller_id: string;
    listing_id: string;
    status: string;
    scheduled_start: string;
    scheduled_end: string;
    total_cents?: number | null;
    currency?: string;
    platform_fee_cents?: number;
    platform_fee_rate?: string;
    notes?: string | null;
    buyer_browse_context?: string | null;
    seller_response_note?: string | null;
    listing_title?: string | null;
    listing_type?: string | null;
    status_history?: BookingStatusEventRead[];
  };

export type BookingStatusEventRead = {
    id: string;
    status: string;
    actor_role: string;
    note?: string | null;
    created_at: string;
  };

export type BookingStatusUpdate = {
    status: string;
    seller_response_note?: string | null;
  };

export type CategoryRead = {
    id: string;
    name: string;
    slug: string;
    parent_id?: string | null;
  };

export type DeliveryFeeHistoryPoint = {
    date: string;
    delivery_fee_cents: number;
    shipping_fee_cents: number;
  };

export type DeliveryFeeSettingsCreate = {
    name: string;
    delivery_fee_cents?: number;
    shipping_fee_cents?: number;
    effective_at?: string | null;
  };

export type DeliveryFeeSettingsRead = {
    id?: string | null;
    name: string;
    delivery_fee_cents?: number;
    shipping_fee_cents?: number;
    effective_at?: string | null;
  };

export type HTTPValidationError = {
    detail?: ValidationError[];
  };

export type ListingAiAssistRequest = {
    listing_id?: string | null;
    title?: string | null;
    description?: string | null;
    type?: ListingType | null;
    category_id?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    highlights?: string | null;
    tone?: string | null;
  };

export type ListingAiAssistResponse = {
    listing_id?: string | null;
    suggestion: ListingAiAssistSuggestion;
  };

export type ListingAiAssistSuggestion = {
    suggested_title: string;
    suggested_description: string;
    suggested_tags: string[];
    suggested_category_id?: string | null;
    summary: string;
  };

export type ListingCreate = {
    seller_id: string;
    category_id?: string | null;
    title: string;
    slug?: string | null;
    description?: string | null;
    type: ListingType;
    status?: string;
    price_cents?: number | null;
    currency?: string;
    inventory_count?: number | null;
    requires_booking?: boolean;
    duration_minutes?: number | null;
    is_local_only?: boolean;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    pickup_enabled?: boolean;
    meetup_enabled?: boolean;
    delivery_enabled?: boolean;
    shipping_enabled?: boolean;
    lead_time_hours?: number | null;
    is_promoted?: boolean;
  };

export type ListingImageCreate = {
    image_url: string;
    alt_text?: string | null;
    sort_order?: number | null;
  };

export type ListingImageRead = {
    id: string;
    listing_id: string;
    image_url: string;
    alt_text?: string | null;
    sort_order?: number;
    created_at: string;
  };

export type ListingImageUploadCreate = {
    filename: string;
    content_type: string;
    base64_data: string;
    alt_text?: string | null;
  };

export type ListingListResponse = {
    items: ListingRead[];
    total: number;
  };

export type ListingPriceInsight = {
    listing_id: string;
    currency: string;
    sample_size: number;
    comparison_scope: string;
    min_price_cents?: number | null;
    max_price_cents?: number | null;
    avg_price_cents?: number | null;
    median_price_cents?: number | null;
    suggested_price_cents?: number | null;
    summary: string;
  };

export type ListingPricingScopeCount = {
    scope: string;
    count: number;
  };

export type ListingPromotionDetail = {
    id: string;
    title: string;
    seller_id: string;
  };

export type ListingPromotionEvent = {
    id: string;
    listing_id: string;
    seller_id: string;
    promoted: boolean;
    platform_fee_rate: string;
    created_at: string;
  };

export type ListingPromotionSummary = {
    type: string;
    count: number;
  };

export type ListingRead = {
    id: string;
    seller_id: string;
    category_id?: string | null;
    category?: string | null;
    title: string;
    slug: string;
    description?: string | null;
    type: ListingType;
    status: string;
    price_cents?: number | null;
    currency?: string;
    inventory_count?: number | null;
    requires_booking?: boolean;
    duration_minutes?: number | null;
    is_local_only?: boolean;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    pickup_enabled?: boolean;
    meetup_enabled?: boolean;
    delivery_enabled?: boolean;
    shipping_enabled?: boolean;
    lead_time_hours?: number | null;
    images?: ListingImageRead[];
    created_at: string;
    updated_at: string;
    last_operating_adjustment_at?: string | null;
    last_operating_adjustment_summary?: string | null;
    last_pricing_comparison_scope?: string | null;
    available_today?: boolean;
    is_new_listing?: boolean;
    recent_transaction_count?: number;
    is_promoted?: boolean;
  };

export type ListingType = "product" | "service" | "hybrid";

export type ListingUpdate = {
    category_id?: string | null;
    title?: string | null;
    slug?: string | null;
    description?: string | null;
    type?: ListingType | null;
    status?: string | null;
    price_cents?: number | null;
    currency?: string | null;
    inventory_count?: number | null;
    requires_booking?: boolean | null;
    duration_minutes?: number | null;
    is_local_only?: boolean | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    pickup_enabled?: boolean | null;
    meetup_enabled?: boolean | null;
    delivery_enabled?: boolean | null;
    shipping_enabled?: boolean | null;
    lead_time_hours?: number | null;
    is_promoted?: boolean | null;
  };

export type NotificationDeliveryBulkActionFailure = {
    id: string;
    detail: string;
  };

export type NotificationDeliveryBulkRetryRequest = {
    delivery_ids: string[];
    execution_mode?: string;
  };

export type NotificationDeliveryBulkRetryResult = {
    succeeded_ids: string[];
    failed: NotificationDeliveryBulkActionFailure[];
  };

export type NotificationDeliveryRead = {
    id: string;
    recipient_user_id: string;
    transaction_kind: string;
    transaction_id: string;
    event_id: string;
    channel: string;
    delivery_status: string;
    payload: {
      [key: string]: unknown;
    };
    failure_reason?: string | null;
    attempts?: number;
    sent_at?: string | null;
    created_at: string;
  };

export type OrderAdminEventRead = {
    id: string;
    actor_user_id: string;
    action: string;
    note?: string | null;
    created_at: string;
  };

export type OrderAdminRead = {
    id: string;
    buyer_id: string;
    seller_id: string;
    status: string;
    fulfillment: string;
    subtotal_cents: number;
    total_cents: number;
    currency?: string;
    delivery_fee_cents?: number;
    platform_fee_cents?: number;
    platform_fee_rate?: string;
    notes?: string | null;
    buyer_browse_context?: string | null;
    seller_response_note?: string | null;
    items?: OrderItemRead[];
    status_history?: OrderStatusEventRead[];
    admin_note?: string | null;
    admin_handoff_note?: string | null;
    admin_assignee_user_id?: string | null;
    admin_assigned_at?: string | null;
    admin_is_escalated?: boolean;
    admin_escalated_at?: string | null;
    admin_history?: OrderAdminEventRead[];
  };

export type OrderAdminSupportUpdate = {
    admin_note?: string | null;
    admin_handoff_note?: string | null;
    admin_assignee_user_id?: string | null;
    admin_is_escalated?: boolean | null;
  };

export type OrderBulkActionFailure = {
    id: string;
    detail: string;
  };

export type OrderBulkStatusUpdateItem = {
    order_id: string;
    status: string;
    seller_response_note?: string | null;
  };

export type OrderBulkStatusUpdateRequest = {
    updates: OrderBulkStatusUpdateItem[];
    execution_mode?: string;
  };

export type OrderBulkStatusUpdateResult = {
    succeeded_ids: string[];
    failed: OrderBulkActionFailure[];
  };

export type OrderCreate = {
    seller_id: string;
    fulfillment: string;
    notes?: string | null;
    buyer_browse_context?: string | null;
    items: OrderItemCreate[];
  };

export type OrderItemCreate = {
    listing_id: string;
    quantity: number;
  };

export type OrderItemRead = {
    id: string;
    listing_id: string;
    quantity: number;
    unit_price_cents: number;
    total_price_cents: number;
    listing_title?: string | null;
  };

export type OrderRead = {
    id: string;
    buyer_id: string;
    seller_id: string;
    status: string;
    fulfillment: string;
    subtotal_cents: number;
    total_cents: number;
    currency?: string;
    delivery_fee_cents?: number;
    platform_fee_cents?: number;
    platform_fee_rate?: string;
    notes?: string | null;
    buyer_browse_context?: string | null;
    seller_response_note?: string | null;
    items?: OrderItemRead[];
    status_history?: OrderStatusEventRead[];
  };

export type OrderStatusEventRead = {
    id: string;
    status: string;
    actor_role: string;
    note?: string | null;
    created_at: string;
  };

export type OrderStatusUpdate = {
    status: string;
    seller_response_note?: string | null;
  };

export type PlatformFeeHistoryPoint = {
    date: string;
    order_fee_cents: number;
    booking_fee_cents: number;
  };

export type PlatformFeeRateCreate = {
    name: string;
    rate: number | string;
    effective_at?: string | null;
  };

export type PlatformFeeRateRead = {
    id?: string | null;
    name: string;
    rate: string;
    effective_at?: string | null;
  };

export type ProfileCreate = {
    full_name?: string | null;
    username?: string | null;
    phone?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    email_notifications_enabled?: boolean;
    push_notifications_enabled?: boolean;
    marketing_notifications_enabled?: boolean;
    expo_push_token?: string | null;
  };

export type ProfileRead = {
    id: string;
    full_name?: string | null;
    username?: string | null;
    phone?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    email_notifications_enabled?: boolean;
    push_notifications_enabled?: boolean;
    marketing_notifications_enabled?: boolean;
    expo_push_token?: string | null;
  };

export type ProfileUpdate = {
    full_name?: string | null;
    username?: string | null;
    phone?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    email_notifications_enabled?: boolean | null;
    push_notifications_enabled?: boolean | null;
    marketing_notifications_enabled?: boolean | null;
    expo_push_token?: string | null;
  };

export type ReviewCreate = {
    rating: number;
    comment?: string | null;
    order_id?: string | null;
    booking_id?: string | null;
  };

export type ReviewLookup = {
    review?: ReviewRead | null;
  };

export type ReviewModerationEventRead = {
    id: string;
    actor_user_id: string;
    action: string;
    note?: string | null;
    created_at: string;
  };

export type ReviewModerationItem = {
    id: string;
    review_id: string;
    reporter_id: string;
    seller_id?: string | null;
    reason: string;
    notes?: string | null;
    status: string;
    moderator_note?: string | null;
    resolution_reason?: string | null;
    assignee_user_id?: string | null;
    assigned_at?: string | null;
    is_escalated?: boolean;
    escalated_at?: string | null;
    created_at: string;
    review: ReviewRead;
    seller_display_name?: string | null;
    seller_slug?: string | null;
    history?: ReviewModerationEventRead[];
  };

export type ReviewRead = {
    id: string;
    rating: number;
    comment?: string | null;
    seller_response?: string | null;
    seller_responded_at?: string | null;
    is_hidden?: boolean;
    hidden_at?: string | null;
    created_at: string;
  };

export type ReviewReportCreate = {
    reason: string;
    notes?: string | null;
  };

export type ReviewReportRead = {
    id: string;
    review_id: string;
    reporter_id: string;
    reason: string;
    notes?: string | null;
    status: string;
    created_at: string;
  };

export type ReviewReportStatusUpdate = {
    status: string;
    moderator_note?: string | null;
    resolution_reason?: string | null;
    assignee_user_id?: string | null;
    is_escalated?: boolean | null;
  };

export type ReviewSellerResponseUpdate = {
    seller_response?: string | null;
  };

export type ReviewVisibilityUpdate = {
    is_hidden: boolean;
    report_id?: string | null;
  };

export type SellerCreate = {
    display_name: string;
    slug: string;
    bio?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    accepts_custom_orders?: boolean;
  };

export type SellerRead = {
    id: string;
    user_id: string;
    display_name: string;
    slug: string;
    bio?: string | null;
    is_verified?: boolean;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    accepts_custom_orders?: boolean;
    average_rating?: number;
    review_count?: number;
  };

export type SellerSubscriptionAssign = {
    seller_slug: string;
    tier_id: string;
    reason_code: "trial_conversion" | "manual_upgrade" | "retention_save" | "support_adjustment" | "plan_reset";
    note?: string | null;
  };

export type SellerSubscriptionEventRead = {
    id?: string | null;
    seller_id: string;
    seller_slug?: string | null;
    seller_display_name?: string | null;
    seller_subscription_id?: string | null;
    actor_user_id: string;
    actor_name?: string | null;
    action: string;
    reason_code?: "trial_conversion" | "manual_upgrade" | "retention_save" | "support_adjustment" | "plan_reset" | null;
    from_tier_id?: string | null;
    from_tier_code?: string | null;
    from_tier_name?: string | null;
    to_tier_id?: string | null;
    to_tier_code?: string | null;
    to_tier_name?: string | null;
    note?: string | null;
    created_at?: string | null;
  };

export type SellerSubscriptionRead = {
    id?: string | null;
    seller_id: string;
    seller_slug?: string | null;
    seller_display_name?: string | null;
    tier_id: string;
    tier_code?: string | null;
    tier_name?: string | null;
    monthly_price_cents?: number;
    perks_summary?: string | null;
    analytics_enabled?: boolean;
    priority_visibility?: boolean;
    premium_storefront?: boolean;
    started_at?: string | null;
    ended_at?: string | null;
    is_active?: boolean;
    created_at?: string | null;
  };

export type SellerUpdate = {
    display_name?: string | null;
    slug?: string | null;
    bio?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    accepts_custom_orders?: boolean | null;
  };

export type SubscriptionTierCreate = {
    code: string;
    name: string;
    monthly_price_cents?: number;
    perks_summary?: string | null;
    analytics_enabled?: boolean;
    priority_visibility?: boolean;
    premium_storefront?: boolean;
    is_active?: boolean;
  };

export type SubscriptionTierRead = {
    id?: string | null;
    code: string;
    name: string;
    monthly_price_cents?: number;
    perks_summary?: string | null;
    analytics_enabled?: boolean;
    priority_visibility?: boolean;
    premium_storefront?: boolean;
    is_active?: boolean;
    created_at?: string | null;
  };

export type ValidationError = {
    loc: (string | number)[];
    msg: string;
    type: string;
    input?: unknown;
    ctx?: Record<string, unknown>;
  };

export type ApiSchemaMap = {
  AdminUserRead: AdminUserRead;
  BookingAdminEventRead: BookingAdminEventRead;
  BookingAdminRead: BookingAdminRead;
  BookingAdminSupportUpdate: BookingAdminSupportUpdate;
  BookingBulkActionFailure: BookingBulkActionFailure;
  BookingBulkStatusUpdateItem: BookingBulkStatusUpdateItem;
  BookingBulkStatusUpdateRequest: BookingBulkStatusUpdateRequest;
  BookingBulkStatusUpdateResult: BookingBulkStatusUpdateResult;
  BookingCreate: BookingCreate;
  BookingRead: BookingRead;
  BookingStatusEventRead: BookingStatusEventRead;
  BookingStatusUpdate: BookingStatusUpdate;
  CategoryRead: CategoryRead;
  DeliveryFeeHistoryPoint: DeliveryFeeHistoryPoint;
  DeliveryFeeSettingsCreate: DeliveryFeeSettingsCreate;
  DeliveryFeeSettingsRead: DeliveryFeeSettingsRead;
  HTTPValidationError: HTTPValidationError;
  ListingAiAssistRequest: ListingAiAssistRequest;
  ListingAiAssistResponse: ListingAiAssistResponse;
  ListingAiAssistSuggestion: ListingAiAssistSuggestion;
  ListingCreate: ListingCreate;
  ListingImageCreate: ListingImageCreate;
  ListingImageRead: ListingImageRead;
  ListingImageUploadCreate: ListingImageUploadCreate;
  ListingListResponse: ListingListResponse;
  ListingPriceInsight: ListingPriceInsight;
  ListingPricingScopeCount: ListingPricingScopeCount;
  ListingPromotionDetail: ListingPromotionDetail;
  ListingPromotionEvent: ListingPromotionEvent;
  ListingPromotionSummary: ListingPromotionSummary;
  ListingRead: ListingRead;
  ListingType: ListingType;
  ListingUpdate: ListingUpdate;
  NotificationDeliveryBulkActionFailure: NotificationDeliveryBulkActionFailure;
  NotificationDeliveryBulkRetryRequest: NotificationDeliveryBulkRetryRequest;
  NotificationDeliveryBulkRetryResult: NotificationDeliveryBulkRetryResult;
  NotificationDeliveryRead: NotificationDeliveryRead;
  OrderAdminEventRead: OrderAdminEventRead;
  OrderAdminRead: OrderAdminRead;
  OrderAdminSupportUpdate: OrderAdminSupportUpdate;
  OrderBulkActionFailure: OrderBulkActionFailure;
  OrderBulkStatusUpdateItem: OrderBulkStatusUpdateItem;
  OrderBulkStatusUpdateRequest: OrderBulkStatusUpdateRequest;
  OrderBulkStatusUpdateResult: OrderBulkStatusUpdateResult;
  OrderCreate: OrderCreate;
  OrderItemCreate: OrderItemCreate;
  OrderItemRead: OrderItemRead;
  OrderRead: OrderRead;
  OrderStatusEventRead: OrderStatusEventRead;
  OrderStatusUpdate: OrderStatusUpdate;
  PlatformFeeHistoryPoint: PlatformFeeHistoryPoint;
  PlatformFeeRateCreate: PlatformFeeRateCreate;
  PlatformFeeRateRead: PlatformFeeRateRead;
  ProfileCreate: ProfileCreate;
  ProfileRead: ProfileRead;
  ProfileUpdate: ProfileUpdate;
  ReviewCreate: ReviewCreate;
  ReviewLookup: ReviewLookup;
  ReviewModerationEventRead: ReviewModerationEventRead;
  ReviewModerationItem: ReviewModerationItem;
  ReviewRead: ReviewRead;
  ReviewReportCreate: ReviewReportCreate;
  ReviewReportRead: ReviewReportRead;
  ReviewReportStatusUpdate: ReviewReportStatusUpdate;
  ReviewSellerResponseUpdate: ReviewSellerResponseUpdate;
  ReviewVisibilityUpdate: ReviewVisibilityUpdate;
  SellerCreate: SellerCreate;
  SellerRead: SellerRead;
  SellerSubscriptionAssign: SellerSubscriptionAssign;
  SellerSubscriptionEventRead: SellerSubscriptionEventRead;
  SellerSubscriptionRead: SellerSubscriptionRead;
  SellerUpdate: SellerUpdate;
  SubscriptionTierCreate: SubscriptionTierCreate;
  SubscriptionTierRead: SubscriptionTierRead;
  ValidationError: ValidationError;
};

export type ApiOperations = {
  "/admin/delivery-fees/history": {
    get: {
      response: DeliveryFeeHistoryPoint[];
    };
  };
  "/admin/listings/pricing-scope-summary": {
    get: {
      response: ListingPricingScopeCount[];
    };
  };
  "/admin/listings/promoted": {
    get: {
      response: ListingPromotionDetail[];
    };
  };
  "/admin/listings/promotions/events": {
    get: {
      response: ListingPromotionEvent[];
    };
  };
  "/admin/listings/promotions/summary": {
    get: {
      response: ListingPromotionSummary[];
    };
  };
  "/admin/listings/{listing_id}/promotion": {
    patch: {
      response: ListingRead;
    };
  };
  "/admin/platform-fees/history": {
    get: {
      response: PlatformFeeHistoryPoint[];
    };
  };
  "/admin/seller-subscription-events": {
    get: {
      response: SellerSubscriptionEventRead[];
    };
  };
  "/admin/seller-subscriptions": {
    get: {
      response: SellerSubscriptionRead[];
    };
    post: {
      requestBody: SellerSubscriptionAssign;
      response: SellerSubscriptionRead;
    };
  };
  "/admin/subscription-tiers": {
    get: {
      response: SubscriptionTierRead[];
    };
    post: {
      requestBody: SubscriptionTierCreate;
      response: SubscriptionTierRead;
    };
  };
  "/admin/users": {
    get: {
      response: AdminUserRead[];
    };
  };
  "/bookings": {
    post: {
      requestBody: BookingCreate;
      response: BookingRead;
    };
  };
  "/bookings/admin": {
    get: {
      response: BookingAdminRead[];
    };
  };
  "/bookings/bulk-status": {
    post: {
      requestBody: BookingBulkStatusUpdateRequest;
      response: BookingBulkStatusUpdateResult;
    };
  };
  "/bookings/me": {
    get: {
      response: BookingRead[];
    };
  };
  "/bookings/seller": {
    get: {
      response: BookingRead[];
    };
  };
  "/bookings/{booking_id}": {
    get: {
      response: BookingRead;
    };
    patch: {
      requestBody: BookingStatusUpdate;
      response: BookingRead;
    };
  };
  "/bookings/{booking_id}/admin-support": {
    patch: {
      requestBody: BookingAdminSupportUpdate;
      response: BookingAdminRead;
    };
  };
  "/categories": {
    get: {
      response: CategoryRead[];
    };
  };
  "/delivery-fees": {
    get: {
      response: DeliveryFeeSettingsRead;
    };
    post: {
      requestBody: DeliveryFeeSettingsCreate;
      response: DeliveryFeeSettingsRead;
    };
  };
  "/health": {
    get: {
      response: {
  [key: string]: string;
};
    };
  };
  "/listings": {
    get: {
      response: ListingListResponse;
    };
    post: {
      requestBody: ListingCreate;
      response: ListingRead;
    };
  };
  "/listings/admin": {
    get: {
      response: ListingRead[];
    };
  };
  "/listings/ai-assist": {
    post: {
      requestBody: ListingAiAssistRequest;
      response: ListingAiAssistResponse;
    };
  };
  "/listings/export": {
    get: {
      response: unknown;
    };
  };
  "/listings/me": {
    get: {
      response: ListingRead[];
    };
  };
  "/listings/{listing_id}": {
    get: {
      response: ListingRead;
    };
    patch: {
      requestBody: ListingUpdate;
      response: ListingRead;
    };
  };
  "/listings/{listing_id}/images": {
    post: {
      requestBody: ListingImageCreate;
      response: ListingImageRead;
    };
  };
  "/listings/{listing_id}/images/upload": {
    post: {
      requestBody: ListingImageUploadCreate;
      response: ListingImageRead;
    };
  };
  "/listings/{listing_id}/images/{image_id}": {
    delete: {
      response: ListingImageRead;
    };
  };
  "/listings/{listing_id}/price-insights": {
    get: {
      response: ListingPriceInsight;
    };
  };
  "/notifications/admin": {
    get: {
      response: NotificationDeliveryRead[];
    };
  };
  "/notifications/admin/bulk-retry": {
    post: {
      requestBody: NotificationDeliveryBulkRetryRequest;
      response: NotificationDeliveryBulkRetryResult;
    };
  };
  "/notifications/admin/{delivery_id}/retry": {
    post: {
      response: NotificationDeliveryRead;
    };
  };
  "/notifications/bulk-retry": {
    post: {
      requestBody: NotificationDeliveryBulkRetryRequest;
      response: NotificationDeliveryBulkRetryResult;
    };
  };
  "/notifications/me": {
    get: {
      response: NotificationDeliveryRead[];
    };
  };
  "/notifications/{delivery_id}/retry": {
    post: {
      response: NotificationDeliveryRead;
    };
  };
  "/orders": {
    post: {
      requestBody: OrderCreate;
      response: OrderRead;
    };
  };
  "/orders/admin": {
    get: {
      response: OrderAdminRead[];
    };
  };
  "/orders/bulk-status": {
    post: {
      requestBody: OrderBulkStatusUpdateRequest;
      response: OrderBulkStatusUpdateResult;
    };
  };
  "/orders/me": {
    get: {
      response: OrderRead[];
    };
  };
  "/orders/seller": {
    get: {
      response: OrderRead[];
    };
  };
  "/orders/{order_id}": {
    get: {
      response: OrderRead;
    };
    patch: {
      requestBody: OrderStatusUpdate;
      response: OrderRead;
    };
  };
  "/orders/{order_id}/admin-support": {
    patch: {
      requestBody: OrderAdminSupportUpdate;
      response: OrderAdminRead;
    };
  };
  "/platform-fees": {
    get: {
      response: PlatformFeeRateRead;
    };
    post: {
      requestBody: PlatformFeeRateCreate;
      response: PlatformFeeRateRead;
    };
  };
  "/profiles/me": {
    get: {
      response: ProfileRead;
    };
    patch: {
      requestBody: ProfileUpdate;
      response: ProfileRead;
    };
    post: {
      requestBody: ProfileCreate;
      response: ProfileRead;
    };
  };
  "/reviews": {
    post: {
      requestBody: ReviewCreate;
      response: ReviewRead;
    };
  };
  "/reviews/me/lookup": {
    get: {
      response: ReviewLookup;
    };
  };
  "/reviews/reports": {
    get: {
      response: ReviewModerationItem[];
    };
  };
  "/reviews/reports/{report_id}": {
    patch: {
      requestBody: ReviewReportStatusUpdate;
      response: ReviewModerationItem;
    };
  };
  "/reviews/{review_id}/report": {
    post: {
      requestBody: ReviewReportCreate;
      response: ReviewReportRead;
    };
  };
  "/reviews/{review_id}/seller-response": {
    patch: {
      requestBody: ReviewSellerResponseUpdate;
      response: ReviewRead;
    };
  };
  "/reviews/{review_id}/visibility": {
    patch: {
      requestBody: ReviewVisibilityUpdate;
      response: ReviewRead;
    };
  };
  "/sellers": {
    post: {
      requestBody: SellerCreate;
      response: SellerRead;
    };
  };
  "/sellers/me": {
    get: {
      response: SellerRead;
    };
    patch: {
      requestBody: SellerUpdate;
      response: SellerRead;
    };
  };
  "/sellers/me/subscription": {
    get: {
      response: SellerSubscriptionRead;
    };
  };
  "/sellers/{slug}": {
    get: {
      response: SellerRead;
    };
  };
  "/sellers/{slug}/reviews": {
    get: {
      response: ReviewRead[];
    };
  };
  "/sellers/{slug}/subscription": {
    get: {
      response: SellerSubscriptionRead;
    };
  };
};
