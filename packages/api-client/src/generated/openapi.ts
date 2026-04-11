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
    is_local_only?: boolean | null;
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

export type BookingConflictEventRead = {
    id: string;
    seller_id: string;
    seller_slug: string;
    seller_display_name: string;
    delivery_id?: string | null;
    actor_user_id: string;
    action: string;
    alert_signature: string;
    booking_id: string;
    listing_id: string;
    conflict_count: number;
    scheduled_start: string;
    scheduled_end: string;
    created_at: string;
  };

export type BookingConflictSellerSummaryRead = {
    seller_id: string;
    seller_slug: string;
    seller_display_name: string;
    event_count: number;
    latest_event_action: string;
    latest_event_status: string;
    latest_event_created_at: string;
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
    is_local_only?: boolean | null;
    status_history?: BookingStatusEventRead[];
  };

export type BookingResponseAiAssistResponse = {
    transaction_kind: string;
    transaction_id: string;
    suggestion: BookingResponseAiAssistSuggestion;
  };

export type BookingResponseAiAssistSuggestion = {
    suggested_note: string;
    summary: string;
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

export type DeliveryFailureEventRead = {
    id: string;
    failed_delivery_id: string;
    delivery_id?: string | null;
    actor_user_id: string;
    action: string;
    alert_signature: string;
    failed_delivery_channel: string;
    failed_delivery_status: string;
    failed_delivery_attempts: number;
    failed_delivery_reason: string;
    original_recipient_user_id?: string | null;
    created_at: string;
  };

export type DeliveryFailureSummaryRead = {
    failed_delivery_id: string;
    transaction_kind: string;
    transaction_id: string;
    failed_delivery_channel: string;
    failed_delivery_status: string;
    failed_delivery_attempts: number;
    failed_delivery_reason: string;
    original_recipient_user_id?: string | null;
    alert_delivery_count: number;
    latest_alert_delivery_status: string;
    latest_alert_delivery_created_at: string;
    acknowledged: boolean;
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

export type InventoryAlertEventRead = {
    id: string;
    seller_id: string;
    seller_slug: string;
    seller_display_name: string;
    delivery_id?: string | null;
    actor_user_id: string;
    action: string;
    alert_signature: string;
    listing_id: string;
    listing_title: string;
    inventory_bucket: string;
    inventory_count?: number | null;
    created_at: string;
  };

export type InventoryAlertSummaryRead = {
    seller_id: string;
    seller_slug: string;
    seller_display_name: string;
    listing_id: string;
    listing_title: string;
    inventory_bucket: string;
    inventory_count?: number | null;
    alert_delivery_count: number;
    latest_alert_delivery_status: string;
    latest_alert_delivery_created_at: string;
    acknowledged: boolean;
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

export type ListingBookingSuggestionRead = {
    listing_id: string;
    suggested_day_offset: number;
    suggested_label: string;
    summary: string;
    rationale: string;
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
    auto_accept_bookings?: boolean;
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
    limit?: number | null;
    offset?: number | null;
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
    type: ListingType;
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
    auto_accept_bookings?: boolean;
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
    auto_accept_bookings?: boolean | null;
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

export type NotificationDeliverySummaryRead = {
    total_deliveries: number;
    queued_deliveries: number;
    failed_deliveries: number;
    sent_deliveries: number;
    email_deliveries: number;
    push_deliveries: number;
    order_deliveries: number;
    booking_deliveries: number;
    failed_last_24h: number;
    queued_older_than_1h: number;
    oldest_queued_created_at?: string | null;
    latest_failure_created_at?: string | null;
  };

export type NotificationWorkerHealthRead = {
    email_provider: string;
    push_provider: string;
    worker_poll_seconds: number;
    batch_size: number;
    max_attempts: number;
    due_queued_deliveries: number;
    processing_deliveries: number;
    stuck_processing_deliveries: number;
    recent_failure_deliveries: number;
    oldest_due_queued_created_at?: string | null;
    oldest_stuck_processing_last_attempt_at?: string | null;
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

export type OrderExceptionEventRead = {
    id: string;
    seller_id: string;
    seller_slug: string;
    seller_display_name: string;
    delivery_id?: string | null;
    actor_user_id: string;
    action: string;
    alert_signature: string;
    order_id: string;
    order_status: string;
    created_at: string;
  };

export type OrderExceptionSellerSummaryRead = {
    seller_id: string;
    seller_slug: string;
    seller_display_name: string;
    event_count: number;
    latest_event_action: string;
    latest_event_status: string;
    latest_event_created_at: string;
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
    listing_type?: string | null;
    is_local_only?: boolean | null;
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

export type OrderResponseAiAssistResponse = {
    transaction_kind: string;
    transaction_id: string;
    suggestion: OrderResponseAiAssistSuggestion;
  };

export type OrderResponseAiAssistSuggestion = {
    suggested_note: string;
    summary: string;
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
    admin_monetization_preferences?: {
      [key: string]: unknown;
    };
    admin_delivery_ops_preferences?: {
      [key: string]: unknown;
    };
    admin_review_moderation_preferences?: {
      [key: string]: unknown;
    };
    admin_transaction_support_preferences?: {
      [key: string]: unknown;
    };
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
    admin_monetization_preferences?: {
      [key: string]: unknown;
    };
    admin_delivery_ops_preferences?: {
      [key: string]: unknown;
    };
    admin_review_moderation_preferences?: {
      [key: string]: unknown;
    };
    admin_transaction_support_preferences?: {
      [key: string]: unknown;
    };
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
    admin_monetization_preferences?: {
      [key: string]: unknown;
    } | null;
    admin_delivery_ops_preferences?: {
      [key: string]: unknown;
    } | null;
    admin_review_moderation_preferences?: {
      [key: string]: unknown;
    } | null;
    admin_transaction_support_preferences?: {
      [key: string]: unknown;
    } | null;
  };

export type ReviewAnomalyRead = {
    seller_id: string;
    seller_slug?: string | null;
    seller_display_name?: string | null;
    active_report_count: number;
    open_report_count: number;
    escalated_report_count: number;
    hidden_open_count: number;
    recent_report_count: number;
    latest_report_at: string;
    severity: string;
    reasons: string[];
  };

export type ReviewAnomalySellerSummaryRead = {
    seller_id: string;
    seller_slug?: string | null;
    seller_display_name?: string | null;
    active_report_count: number;
    latest_report_at: string;
    severity: string;
    reasons: string[];
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

export type ReviewResponseAiAssistResponse = {
    review_id: string;
    suggestion: ReviewResponseAiAssistSuggestion;
  };

export type ReviewResponseAiAssistSuggestion = {
    suggested_response: string;
    summary: string;
  };

export type ReviewResponseReminderEventRead = {
    id: string;
    seller_id: string;
    seller_slug: string;
    seller_display_name: string;
    delivery_id?: string | null;
    actor_user_id: string;
    action: string;
    alert_signature: string;
    latest_review_id?: string | null;
    latest_review_rating?: number | null;
    pending_review_count: number;
    created_at: string;
  };

export type ReviewResponseReminderSellerSummaryRead = {
    seller_id: string;
    seller_slug: string;
    seller_display_name: string;
    reminder_count: number;
    latest_review_id?: string | null;
    latest_review_rating?: number | null;
    latest_alert_delivery_status: string;
    latest_alert_delivery_created_at: string;
    acknowledged: boolean;
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

export type SellerListingSummaryRead = {
    seller_id: string;
    total: number;
    product_count?: number;
    service_count?: number;
    hybrid_count?: number;
    active_count?: number;
    draft_count?: number;
    promoted_count?: number;
    available_today_count?: number;
    quick_booking_count?: number;
    local_only_count?: number;
    price_surface_cents?: number;
  };

export type SellerLookupRead = {
    id: string;
    display_name: string;
    slug: string;
    is_verified?: boolean;
    city?: string | null;
    state?: string | null;
    country?: string | null;
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
    trust_score?: SellerTrustScoreRead | null;
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

export type SellerTrustInterventionRead = {
    seller: SellerRead;
    risk_level: string;
    trend_direction: string;
    trend_summary: string;
    intervention_reason: string;
    intervention_priority?: string;
    intervention_lane?: string;
  };

export type SellerTrustScoreRead = {
    score: number;
    label: string;
    summary: string;
    risk_level?: string;
    trend_direction?: string;
    trend_summary?: string;
    trend_delta?: number;
    risk_reasons?: string[];
    review_quality_score?: number;
    response_rate_score?: number;
    completion_score?: number;
    delivery_reliability_score?: number;
    verified_bonus?: number;
    review_count?: number;
    response_rate?: number;
    completion_rate?: number;
    delivery_success_rate?: number;
    hidden_review_count?: number;
    completed_transactions?: number;
    total_transactions?: number;
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

export type SubscriptionDowngradeEventRead = {
    id: string;
    seller_id: string;
    seller_slug: string;
    seller_display_name: string;
    delivery_id?: string | null;
    actor_user_id: string;
    action: string;
    alert_signature: string;
    seller_subscription_id?: string | null;
    from_tier_id?: string | null;
    from_tier_name?: string | null;
    to_tier_id?: string | null;
    to_tier_name?: string | null;
    reason_code?: string | null;
    note?: string | null;
    created_at: string;
  };

export type SubscriptionDowngradeSellerSummaryRead = {
    seller_id: string;
    seller_slug: string;
    seller_display_name: string;
    alert_delivery_count: number;
    latest_alert_delivery_id?: string | null;
    latest_alert_delivery_status: string;
    latest_alert_delivery_created_at: string;
    previous_tier_name?: string | null;
    current_tier_name?: string | null;
    reason_code?: string | null;
    acknowledged: boolean;
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

export type TrustAlertEventRead = {
    id: string;
    seller_id: string;
    seller_slug: string;
    seller_display_name: string;
    delivery_id?: string | null;
    actor_user_id: string;
    action: string;
    alert_signature: string;
    risk_level: string;
    trend_direction: string;
    created_at: string;
  };

export type TrustAlertSellerSummaryRead = {
    seller_id: string;
    seller_slug: string;
    seller_display_name: string;
    event_count: number;
    latest_event_action: string;
    latest_event_risk_level: string;
    latest_event_trend_direction: string;
    latest_event_created_at: string;
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
  BookingConflictEventRead: BookingConflictEventRead;
  BookingConflictSellerSummaryRead: BookingConflictSellerSummaryRead;
  BookingCreate: BookingCreate;
  BookingRead: BookingRead;
  BookingResponseAiAssistResponse: BookingResponseAiAssistResponse;
  BookingResponseAiAssistSuggestion: BookingResponseAiAssistSuggestion;
  BookingStatusEventRead: BookingStatusEventRead;
  BookingStatusUpdate: BookingStatusUpdate;
  CategoryRead: CategoryRead;
  DeliveryFailureEventRead: DeliveryFailureEventRead;
  DeliveryFailureSummaryRead: DeliveryFailureSummaryRead;
  DeliveryFeeHistoryPoint: DeliveryFeeHistoryPoint;
  DeliveryFeeSettingsCreate: DeliveryFeeSettingsCreate;
  DeliveryFeeSettingsRead: DeliveryFeeSettingsRead;
  HTTPValidationError: HTTPValidationError;
  InventoryAlertEventRead: InventoryAlertEventRead;
  InventoryAlertSummaryRead: InventoryAlertSummaryRead;
  ListingAiAssistRequest: ListingAiAssistRequest;
  ListingAiAssistResponse: ListingAiAssistResponse;
  ListingAiAssistSuggestion: ListingAiAssistSuggestion;
  ListingBookingSuggestionRead: ListingBookingSuggestionRead;
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
  NotificationDeliverySummaryRead: NotificationDeliverySummaryRead;
  NotificationWorkerHealthRead: NotificationWorkerHealthRead;
  OrderAdminEventRead: OrderAdminEventRead;
  OrderAdminRead: OrderAdminRead;
  OrderAdminSupportUpdate: OrderAdminSupportUpdate;
  OrderBulkActionFailure: OrderBulkActionFailure;
  OrderBulkStatusUpdateItem: OrderBulkStatusUpdateItem;
  OrderBulkStatusUpdateRequest: OrderBulkStatusUpdateRequest;
  OrderBulkStatusUpdateResult: OrderBulkStatusUpdateResult;
  OrderCreate: OrderCreate;
  OrderExceptionEventRead: OrderExceptionEventRead;
  OrderExceptionSellerSummaryRead: OrderExceptionSellerSummaryRead;
  OrderItemCreate: OrderItemCreate;
  OrderItemRead: OrderItemRead;
  OrderRead: OrderRead;
  OrderResponseAiAssistResponse: OrderResponseAiAssistResponse;
  OrderResponseAiAssistSuggestion: OrderResponseAiAssistSuggestion;
  OrderStatusEventRead: OrderStatusEventRead;
  OrderStatusUpdate: OrderStatusUpdate;
  PlatformFeeHistoryPoint: PlatformFeeHistoryPoint;
  PlatformFeeRateCreate: PlatformFeeRateCreate;
  PlatformFeeRateRead: PlatformFeeRateRead;
  ProfileCreate: ProfileCreate;
  ProfileRead: ProfileRead;
  ProfileUpdate: ProfileUpdate;
  ReviewAnomalyRead: ReviewAnomalyRead;
  ReviewAnomalySellerSummaryRead: ReviewAnomalySellerSummaryRead;
  ReviewCreate: ReviewCreate;
  ReviewLookup: ReviewLookup;
  ReviewModerationEventRead: ReviewModerationEventRead;
  ReviewModerationItem: ReviewModerationItem;
  ReviewRead: ReviewRead;
  ReviewReportCreate: ReviewReportCreate;
  ReviewReportRead: ReviewReportRead;
  ReviewReportStatusUpdate: ReviewReportStatusUpdate;
  ReviewResponseAiAssistResponse: ReviewResponseAiAssistResponse;
  ReviewResponseAiAssistSuggestion: ReviewResponseAiAssistSuggestion;
  ReviewResponseReminderEventRead: ReviewResponseReminderEventRead;
  ReviewResponseReminderSellerSummaryRead: ReviewResponseReminderSellerSummaryRead;
  ReviewSellerResponseUpdate: ReviewSellerResponseUpdate;
  ReviewVisibilityUpdate: ReviewVisibilityUpdate;
  SellerCreate: SellerCreate;
  SellerListingSummaryRead: SellerListingSummaryRead;
  SellerLookupRead: SellerLookupRead;
  SellerRead: SellerRead;
  SellerSubscriptionAssign: SellerSubscriptionAssign;
  SellerSubscriptionEventRead: SellerSubscriptionEventRead;
  SellerSubscriptionRead: SellerSubscriptionRead;
  SellerTrustInterventionRead: SellerTrustInterventionRead;
  SellerTrustScoreRead: SellerTrustScoreRead;
  SellerUpdate: SellerUpdate;
  SubscriptionDowngradeEventRead: SubscriptionDowngradeEventRead;
  SubscriptionDowngradeSellerSummaryRead: SubscriptionDowngradeSellerSummaryRead;
  SubscriptionTierCreate: SubscriptionTierCreate;
  SubscriptionTierRead: SubscriptionTierRead;
  TrustAlertEventRead: TrustAlertEventRead;
  TrustAlertSellerSummaryRead: TrustAlertSellerSummaryRead;
  ValidationError: ValidationError;
};

export type ApiOperations = {
  "/admin/delivery-fees/history": {
    get: {
      response: DeliveryFeeHistoryPoint[];
    };
  };
  "/admin/listings/pricing-scope-items": {
    get: {
      response: ListingRead[];
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
  "/admin/seller-trust/interventions": {
    get: {
      response: SellerTrustInterventionRead[];
    };
  };
  "/admin/sellers": {
    get: {
      response: SellerLookupRead[];
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
  "/bookings/{booking_id}/response-ai-assist": {
    post: {
      response: BookingResponseAiAssistResponse;
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
  "/listings/{listing_id}/booking-suggestion": {
    get: {
      response: ListingBookingSuggestionRead;
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
  "/notifications/admin/booking-conflicts/events": {
    get: {
      response: BookingConflictEventRead[];
    };
  };
  "/notifications/admin/booking-conflicts/sellers": {
    get: {
      response: BookingConflictSellerSummaryRead[];
    };
  };
  "/notifications/admin/booking-conflicts/{seller_id}/acknowledge": {
    delete: {
      response: NotificationDeliveryRead[];
    };
    post: {
      response: NotificationDeliveryRead[];
    };
  };
  "/notifications/admin/bulk-retry": {
    post: {
      requestBody: NotificationDeliveryBulkRetryRequest;
      response: NotificationDeliveryBulkRetryResult;
    };
  };
  "/notifications/admin/delivery-failures/events": {
    get: {
      response: DeliveryFailureEventRead[];
    };
  };
  "/notifications/admin/delivery-failures/summaries": {
    get: {
      response: DeliveryFailureSummaryRead[];
    };
  };
  "/notifications/admin/delivery-failures/{failed_delivery_id}/acknowledge": {
    delete: {
      response: NotificationDeliveryRead[];
    };
    post: {
      response: NotificationDeliveryRead[];
    };
  };
  "/notifications/admin/inventory-alerts/events": {
    get: {
      response: InventoryAlertEventRead[];
    };
  };
  "/notifications/admin/inventory-alerts/summaries": {
    get: {
      response: InventoryAlertSummaryRead[];
    };
  };
  "/notifications/admin/inventory-alerts/{seller_id}/{listing_id}/acknowledge": {
    delete: {
      response: NotificationDeliveryRead[];
    };
    post: {
      response: NotificationDeliveryRead[];
    };
  };
  "/notifications/admin/order-exceptions/events": {
    get: {
      response: OrderExceptionEventRead[];
    };
  };
  "/notifications/admin/order-exceptions/sellers": {
    get: {
      response: OrderExceptionSellerSummaryRead[];
    };
  };
  "/notifications/admin/order-exceptions/{seller_id}/acknowledge": {
    delete: {
      response: NotificationDeliveryRead[];
    };
    post: {
      response: NotificationDeliveryRead[];
    };
  };
  "/notifications/admin/review-response-reminders/events": {
    get: {
      response: ReviewResponseReminderEventRead[];
    };
  };
  "/notifications/admin/review-response-reminders/summaries": {
    get: {
      response: ReviewResponseReminderSellerSummaryRead[];
    };
  };
  "/notifications/admin/review-response-reminders/{seller_id}/acknowledge": {
    delete: {
      response: NotificationDeliveryRead[];
    };
    post: {
      response: NotificationDeliveryRead[];
    };
  };
  "/notifications/admin/subscription-downgrades/events": {
    get: {
      response: SubscriptionDowngradeEventRead[];
    };
  };
  "/notifications/admin/subscription-downgrades/sellers": {
    get: {
      response: SubscriptionDowngradeSellerSummaryRead[];
    };
  };
  "/notifications/admin/subscription-downgrades/{seller_id}/acknowledge": {
    delete: {
      response: NotificationDeliveryRead[];
    };
    post: {
      response: NotificationDeliveryRead[];
    };
  };
  "/notifications/admin/summary": {
    get: {
      response: NotificationDeliverySummaryRead;
    };
  };
  "/notifications/admin/trust-alerts/events": {
    get: {
      response: TrustAlertEventRead[];
    };
  };
  "/notifications/admin/trust-alerts/sellers": {
    get: {
      response: TrustAlertSellerSummaryRead[];
    };
  };
  "/notifications/admin/trust-alerts/{seller_id}/acknowledge": {
    delete: {
      response: NotificationDeliveryRead[];
    };
    post: {
      response: NotificationDeliveryRead[];
    };
  };
  "/notifications/admin/worker-health": {
    get: {
      response: NotificationWorkerHealthRead;
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
  "/orders/{order_id}/response-ai-assist": {
    post: {
      response: OrderResponseAiAssistResponse;
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
  "/reviews/anomalies": {
    get: {
      response: ReviewAnomalyRead[];
    };
  };
  "/reviews/anomalies/sellers": {
    get: {
      response: ReviewAnomalySellerSummaryRead[];
    };
  };
  "/reviews/anomalies/{seller_id}/acknowledge": {
    delete: {
      response: NotificationDeliveryRead[];
    };
    post: {
      response: NotificationDeliveryRead[];
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
  "/reviews/{review_id}/ai-assist": {
    post: {
      response: ReviewResponseAiAssistResponse;
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
  "/sellers/by-id/{seller_id}": {
    get: {
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
  "/sellers/{slug}/listings": {
    get: {
      response: ListingListResponse;
    };
  };
  "/sellers/{slug}/listings/summary": {
    get: {
      response: SellerListingSummaryRead;
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
