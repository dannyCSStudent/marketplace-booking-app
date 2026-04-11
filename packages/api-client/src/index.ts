import type { ApiOperations, ApiSchemaMap } from "./generated/openapi";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type HttpMethod = "get" | "post" | "patch" | "delete";
type KnownPath = keyof ApiOperations;

type PathsForMethod<Method extends HttpMethod> = {
  [Path in KnownPath]: Method extends keyof ApiOperations[Path] ? Path : never;
}[KnownPath];

type ResponseFor<Path extends KnownPath, Method extends keyof ApiOperations[Path]> =
  ApiOperations[Path][Method] extends { response: infer Response } ? Response : never;

type RequestBodyFor<Path extends KnownPath, Method extends keyof ApiOperations[Path]> =
  ApiOperations[Path][Method] extends { requestBody: infer Body } ? Body : never;

export type Listing = ApiSchemaMap["ListingRead"] & {
  auto_accept_bookings?: boolean;
};
export type ListingType = ApiSchemaMap["ListingType"];
export type ListingPricingScopeCount = ApiSchemaMap["ListingPricingScopeCount"];
export type PlatformFeeRateRead = ApiSchemaMap["PlatformFeeRateRead"];
export type PlatformFeeRateCreate = ApiSchemaMap["PlatformFeeRateCreate"];
export type PlatformFeeHistoryPoint = ApiSchemaMap["PlatformFeeHistoryPoint"];
export type DeliveryFeeSettingsRead = ApiSchemaMap["DeliveryFeeSettingsRead"];
export type DeliveryFeeSettingsCreate = ApiSchemaMap["DeliveryFeeSettingsCreate"];
export type DeliveryFeeHistoryPoint = ApiSchemaMap["DeliveryFeeHistoryPoint"];
export type SubscriptionTierRead = ApiSchemaMap["SubscriptionTierRead"];
export type SubscriptionTierCreate = ApiSchemaMap["SubscriptionTierCreate"];
export type SellerLookupRead = ApiSchemaMap["SellerLookupRead"];
export type SellerSubscriptionRead = ApiSchemaMap["SellerSubscriptionRead"];
export type SellerSubscriptionAssign = ApiSchemaMap["SellerSubscriptionAssign"];
export type SellerSubscriptionEventRead = ApiSchemaMap["SellerSubscriptionEventRead"];
export type SellerListingSummary = ApiSchemaMap["SellerListingSummaryRead"];
export type SellerTrustIntervention = ApiSchemaMap["SellerTrustInterventionRead"];
export type TrustAlertSellerSummaryRead = ApiSchemaMap["TrustAlertSellerSummaryRead"];
export type CategoryRead = {
  id: string;
  name: string;
  slug: string;
  parent_id?: string | null;
};
export type ListingImage = ApiSchemaMap["ListingImageRead"];
export type ListingResponse = ApiSchemaMap["ListingListResponse"];
export type Booking = ApiSchemaMap["BookingRead"];
export type Order = ApiSchemaMap["OrderRead"];
export type BookingAdmin = ApiSchemaMap["BookingAdminRead"] & {
  admin_history?: Array<{
    id: string;
    actor_user_id: string;
    action: string;
    note?: string | null;
    created_at: string;
  }>;
};
export type OrderAdmin = ApiSchemaMap["OrderAdminRead"] & {
  admin_history?: Array<{
    id: string;
    actor_user_id: string;
    action: string;
    note?: string | null;
    created_at: string;
  }>;
};
export type Profile = ApiSchemaMap["ProfileRead"];
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
export type ReviewCreateInput = {
  rating: number;
  comment?: string | null;
  order_id?: string | null;
  booking_id?: string | null;
};
export type ReviewSellerResponseUpdateInput = {
  seller_response?: string | null;
};
export type ReviewResponseAiAssistSuggestion = {
  suggested_response: string;
  summary: string;
};
export type ReviewResponseAiAssistResponse = {
  review_id: string;
  suggestion: ReviewResponseAiAssistSuggestion;
};
export type ReviewReportCreateInput = {
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
  history?: Array<{
    id: string;
    actor_user_id: string;
    action: string;
    note?: string | null;
    created_at: string;
  }>;
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
export type ReviewAnomalyAckInput = {
  seller_id: string;
};
export type ReviewVisibilityUpdateInput = {
  is_hidden: boolean;
  report_id?: string | null;
};
export type ReviewReportStatusUpdateInput = {
  status: string;
  moderator_note?: string | null;
  resolution_reason?: string | null;
};
export type ReviewLookup = {
  review: ReviewRead | null;
};
export type SellerProfile = ApiSchemaMap["SellerRead"];
export type ProfilePayload = ApiSchemaMap["ProfileCreate"];
export type ProfileUpdateInput = ApiSchemaMap["ProfileUpdate"];
export type BookingCreateInput = ApiSchemaMap["BookingCreate"];
export type BookingStatusUpdateInput = ApiSchemaMap["BookingStatusUpdate"];
export type OrderResponseAiAssistSuggestion = {
  suggested_note: string;
  summary: string;
};
export type OrderResponseAiAssistResponse = {
  transaction_kind: string;
  transaction_id: string;
  suggestion: OrderResponseAiAssistSuggestion;
};
export type BookingResponseAiAssistSuggestion = {
  suggested_note: string;
  summary: string;
};
export type BookingResponseAiAssistResponse = {
  transaction_kind: string;
  transaction_id: string;
  suggestion: BookingResponseAiAssistSuggestion;
};
export type ListingCreateInput = ApiSchemaMap["ListingCreate"] & {
  auto_accept_bookings?: boolean;
};
export type ListingImageCreateInput = ApiSchemaMap["ListingImageCreate"];
export type ListingImageUploadCreateInput = ApiSchemaMap["ListingImageUploadCreate"];
export type ListingUpdateInput = ApiSchemaMap["ListingUpdate"] & {
  auto_accept_bookings?: boolean;
};
export type ListingAiAssistRequest = ApiSchemaMap["ListingAiAssistRequest"];
export type ListingAiAssistSuggestion = ApiSchemaMap["ListingAiAssistSuggestion"];
export type ListingAiAssistResponse = ApiSchemaMap["ListingAiAssistResponse"];
export type ListingBookingSuggestionRead = {
  listing_id: string;
  suggested_day_offset: number;
  suggested_label: string;
  summary: string;
  rationale: string;
};
export type ListingPromotionSummary = ApiSchemaMap["ListingPromotionSummary"];
export type ListingPromotionEvent = ApiSchemaMap["ListingPromotionEvent"];
export type ListingPriceInsight = ApiSchemaMap["ListingPriceInsight"];
export type OrderCreateInput = ApiSchemaMap["OrderCreate"];
export type OrderStatusUpdateInput = ApiSchemaMap["OrderStatusUpdate"];
export type SellerCreateInput = ApiSchemaMap["SellerCreate"];
export type SellerUpdateInput = ApiSchemaMap["SellerUpdate"];
export type OrderBulkStatusUpdateRequest = ApiSchemaMap["OrderBulkStatusUpdateRequest"];
export type OrderBulkStatusUpdateResult = ApiSchemaMap["OrderBulkStatusUpdateResult"];
export type BookingBulkStatusUpdateRequest = ApiSchemaMap["BookingBulkStatusUpdateRequest"];
export type BookingBulkStatusUpdateResult = ApiSchemaMap["BookingBulkStatusUpdateResult"];
export type NotificationDeliveryBulkRetryRequest =
  ApiSchemaMap["NotificationDeliveryBulkRetryRequest"];
export type NotificationDeliveryBulkRetryResult =
  ApiSchemaMap["NotificationDeliveryBulkRetryResult"];
export type NotificationDeliverySummary = ApiSchemaMap["NotificationDeliverySummaryRead"];
export type NotificationWorkerHealth = ApiSchemaMap["NotificationWorkerHealthRead"];
export type TrustAlertEventRead = ApiSchemaMap["TrustAlertEventRead"];
export type ApiSchemas = ApiSchemaMap;
export type BuyerEngagementContext = {
  orders: Order[];
  bookings: Booking[];
};
export type SellerWorkspaceData = {
  seller: SellerProfile;
  subscription: SellerSubscriptionRead | null;
  listings: Listing[];
  orders: Order[];
  bookings: Booking[];
  reviews: ReviewRead[];
};
export type AdminUser = ApiSchemaMap["AdminUserRead"];
export type AdminTransactionsData = {
  orders: OrderAdmin[];
  bookings: BookingAdmin[];
  admins: AdminUser[];
  deliveries: NotificationDelivery[];
  listings: Listing[];
};
export type AdminDeliveriesData = {
  admins: AdminUser[];
  deliveries: NotificationDelivery[];
  summary: NotificationDeliverySummary | null;
  workerHealth: NotificationWorkerHealth | null;
};
export type OrderAdminSupportUpdateInput = ApiSchemaMap["OrderAdminSupportUpdate"];
export type BookingAdminSupportUpdateInput = ApiSchemaMap["BookingAdminSupportUpdate"];
export type NotificationAudience = "buyer" | "seller";
export type NotificationItem = {
  id: string;
  transactionKind: "order" | "booking";
  transactionId: string;
  status: string;
  actorRole: string;
  note: string | null;
  createdAt: string;
  title: string;
  message: string;
};
export type NotificationDelivery = ApiSchemaMap["NotificationDeliveryRead"];

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  accessToken?: string;
  body?: unknown;
  cache?: RequestCache;
};

type RequestConfig = Omit<RequestOptions, "method" | "body">;
type PublicListingsPageParams = {
  limit?: number;
  offset?: number;
};

export function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

export const apiRoutes = {
  sellerBySlug: (slug: string) => `/sellers/${slug}`,
  sellerById: (sellerId: string) => `/sellers/by-id/${sellerId}`,
  sellerListingSummaryBySlug: (slug: string) => `/sellers/${slug}/listings/summary`,
  sellerListingsBySlug: (
    slug: string,
    params?: { query?: string; category?: string; type?: string; limit?: number; offset?: number },
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.query) {
      searchParams.set("query", params.query);
    }
    if (params?.category) {
      searchParams.set("category", params.category);
    }
    if (params?.type) {
      searchParams.set("type", params.type);
    }
    if (typeof params?.limit === "number") {
      searchParams.set("limit", String(params.limit));
    }
    if (typeof params?.offset === "number") {
      searchParams.set("offset", String(params.offset));
    }
    const suffix = searchParams.toString();
    return `/sellers/${slug}/listings${suffix ? `?${suffix}` : ""}`;
  },
  sellerReviewsBySlug: (slug: string) => `/sellers/${slug}/reviews`,
  sellerSubscriptionBySlug: (slug: string) => `/sellers/${slug}/subscription`,
  mySellerSubscription: "/sellers/me/subscription",
  myReviewLookup: (query: string) => `/reviews/me/lookup?${query}`,
  reviewResponseAiAssist: (reviewId: string) => `/reviews/${reviewId}/ai-assist`,
  reviewAnomalies: (limit?: number) => `/reviews/anomalies${limit ? `?limit=${limit}` : ""}`,
  reviewAnomalySellers: (limit?: number) => `/reviews/anomalies/sellers${limit ? `?limit=${limit}` : ""}`,
  reviewAnomalyAcknowledge: (sellerId: string) => `/reviews/anomalies/${sellerId}/acknowledge`,
  reviewSellerResponse: (reviewId: string) => `/reviews/${reviewId}/seller-response`,
  orderResponseAiAssist: (orderId: string) => `/orders/${orderId}/response-ai-assist`,
  bookingResponseAiAssist: (bookingId: string) => `/bookings/${bookingId}/response-ai-assist`,
  reviewReport: (reviewId: string) => `/reviews/${reviewId}/report`,
  reviewVisibility: (reviewId: string) => `/reviews/${reviewId}/visibility`,
  listingById: (listingId: string) => `/listings/${listingId}`,
  categories: "/categories",
  listingImages: (listingId: string) => `/listings/${listingId}/images`,
  listingImageUpload: (listingId: string) => `/listings/${listingId}/images/upload`,
  listingPriceInsight: (listingId: string) => `/listings/${listingId}/price-insights`,
  listingBookingSuggestion: (listingId: string) => `/listings/${listingId}/booking-suggestion`,
  promotedListings: "/admin/listings/promoted",
  promotionSummary: "/admin/listings/promotions/summary",
  promotionEvents: "/admin/listings/promotions/events",
  platformFeeHistory: (days?: number) =>
    `/admin/platform-fees/history${days ? `?days=${days}` : ""}`,
  deliveryFeeHistory: (days?: number) =>
    `/admin/delivery-fees/history${days ? `?days=${days}` : ""}`,
  adminSellers: (query?: string, limit?: number) => {
    const searchParams = new URLSearchParams();
    if (query) {
      searchParams.set("query", query);
    }
    if (limit) {
      searchParams.set("limit", String(limit));
    }
    const suffix = searchParams.toString();
    return `/admin/sellers${suffix ? `?${suffix}` : ""}`;
  },
  subscriptionTiers: "/admin/subscription-tiers",
  sellerSubscriptions: "/admin/seller-subscriptions",
  sellerSubscriptionEvents: "/admin/seller-subscription-events",
  sellerTrustInterventions: (limit?: number) =>
    `/admin/seller-trust/interventions${limit ? `?limit=${limit}` : ""}`,
  notificationDeliverySummary: "/notifications/admin/summary",
  notificationWorkerHealth: "/notifications/admin/worker-health",
  acknowledgeTrustAlert: (sellerId: string) => `/notifications/admin/trust-alerts/${sellerId}/acknowledge`,
  trustAlertEvents: (limit?: number) => `/notifications/admin/trust-alerts/events${limit ? `?limit=${limit}` : ""}`,
  trustAlertSellerSummaries: (limit?: number, action?: "acknowledged" | "cleared") => {
    const searchParams = new URLSearchParams();
    if (limit) {
      searchParams.set("limit", String(limit));
    }
    if (action) {
      searchParams.set("action", action);
    }
    const suffix = searchParams.toString();
    return `/notifications/admin/trust-alerts/sellers${suffix ? `?${suffix}` : ""}`;
  },
  deliveryFees: "/delivery-fees",
  listingPromotion: (listingId: string) => `/admin/listings/${listingId}/promotion`,
  orderById: (orderId: string) => `/orders/${orderId}`,
  bookingById: (bookingId: string) => `/bookings/${bookingId}`,
  platformFees: "/platform-fees",
} as const;

export function createApiClient(baseUrl: string) {
  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.accessToken) {
      Object.assign(headers, authHeaders(options.accessToken));
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      cache: options.cache,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (!response.ok) {
      const payload = await response
        .json()
        .catch(() => ({ detail: "Request failed" }));
      throw new ApiError(response.status, payload.detail ?? "Request failed");
    }

    return (await response.json()) as T;
  }

  function get<Path extends PathsForMethod<"get">>(
    path: Path,
    options?: Omit<RequestOptions, "method" | "body">,
  ): Promise<ResponseFor<Path, "get">>;
  function get<T>(path: string, options?: Omit<RequestOptions, "method" | "body">): Promise<T>;
  function get<T>(path: string, options?: Omit<RequestOptions, "method" | "body">) {
    return request<T>(path, { ...options, method: "GET" });
  }

  function post<Path extends PathsForMethod<"post">>(
    path: Path,
    body: RequestBodyFor<Path, "post">,
    options?: Omit<RequestOptions, "method" | "body">,
  ): Promise<ResponseFor<Path, "post">>;
  function post<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">,
  ): Promise<T>;
  function post<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">,
  ) {
    return request<T>(path, { ...options, method: "POST", body });
  }

  function patch<Path extends PathsForMethod<"patch">>(
    path: Path,
    body: RequestBodyFor<Path, "patch">,
    options?: Omit<RequestOptions, "method" | "body">,
  ): Promise<ResponseFor<Path, "patch">>;
  function patch<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">,
  ): Promise<T>;
  function patch<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">,
  ) {
    return request<T>(path, { ...options, method: "PATCH", body });
  }

  function del<Path extends PathsForMethod<"delete">>(
    path: Path,
    options?: Omit<RequestOptions, "method" | "body">,
  ): Promise<ResponseFor<Path, "delete">>;
  function del<T>(path: string, options?: Omit<RequestOptions, "method" | "body">): Promise<T>;
  function del<T>(path: string, options?: Omit<RequestOptions, "method" | "body">) {
    return request<T>(path, { ...options, method: "DELETE" });
  }

  function getSellerBySlug(slug: string, options?: RequestConfig) {
    return get<SellerProfile>(apiRoutes.sellerBySlug(slug), options);
  }

  function getSellerById(sellerId: string, options?: RequestConfig) {
    return get<SellerProfile>(apiRoutes.sellerById(sellerId), options);
  }

  function getSellerListingSummaryBySlug(slug: string, options?: RequestConfig) {
    return get<SellerListingSummary>(apiRoutes.sellerListingSummaryBySlug(slug), options);
  }

  function getSellerListingsBySlug(
    slug: string,
    options?: RequestConfig,
    params?: { query?: string; category?: string; type?: string; limit?: number; offset?: number },
  ) {
    return get<ListingResponse>(apiRoutes.sellerListingsBySlug(slug, params), options);
  }

  function listCategories(options?: RequestConfig) {
    return get<CategoryRead[]>(apiRoutes.categories, options);
  }

  function getSellerReviewsBySlug(slug: string, options?: RequestConfig) {
    return get<ReviewRead[]>(apiRoutes.sellerReviewsBySlug(slug), options);
  }

  function getSellerSubscriptionBySlug(slug: string, options?: RequestConfig) {
    return get<SellerSubscriptionRead>(apiRoutes.sellerSubscriptionBySlug(slug), options);
  }

  function getMySellerSubscription(options: RequestConfig) {
    return get<SellerSubscriptionRead>(apiRoutes.mySellerSubscription, options).catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    });
  }

  function acknowledgeAdminTrustAlert(sellerId: string, options: RequestConfig) {
    return post<NotificationDelivery[]>(
      apiRoutes.acknowledgeTrustAlert(sellerId),
      undefined,
      options,
    );
  }

  function clearAdminTrustAlertAcknowledgement(sellerId: string, options: RequestConfig) {
    return del<NotificationDelivery[]>(apiRoutes.acknowledgeTrustAlert(sellerId), options);
  }

  function listAdminTrustAlertEvents(limit?: number, options?: RequestConfig) {
    return get<TrustAlertEventRead[]>(apiRoutes.trustAlertEvents(limit), options);
  }

  function listAdminTrustAlertSellerSummaries(
    limit?: number,
    action?: "acknowledged" | "cleared",
    options?: RequestConfig,
  ) {
    return get<TrustAlertSellerSummaryRead[]>(
      apiRoutes.trustAlertSellerSummaries(limit, action),
      options,
    );
  }

  function getMyReviewLookup(
    params: { orderId?: string; bookingId?: string },
    accessToken: string,
  ) {
    const query = new URLSearchParams();
    if (params.orderId) {
      query.set("order_id", params.orderId);
    }
    if (params.bookingId) {
      query.set("booking_id", params.bookingId);
    }

    return get<ReviewLookup>(apiRoutes.myReviewLookup(query.toString()), { accessToken });
  }

  function getListingById(listingId: string, options?: RequestConfig) {
    return get<Listing>(apiRoutes.listingById(listingId), options);
  }

  function getOrderById(orderId: string, options?: RequestConfig) {
    return get<Order>(apiRoutes.orderById(orderId), options);
  }

  function getBookingById(bookingId: string, options?: RequestConfig) {
    return get<Booking>(apiRoutes.bookingById(bookingId), options);
  }

  function getPlatformFees(options?: RequestConfig) {
    return get<PlatformFeeRateRead>(apiRoutes.platformFees, options);
  }

  function getDeliveryFees(options?: RequestConfig) {
    return get<DeliveryFeeSettingsRead>(apiRoutes.deliveryFees, options);
  }

  function createPlatformFeeRate(body: PlatformFeeRateCreate, options?: RequestConfig) {
    return post<PlatformFeeRateRead>(apiRoutes.platformFees, body, options);
  }

  function createDeliveryFees(body: DeliveryFeeSettingsCreate, options: RequestConfig) {
    return post<DeliveryFeeSettingsRead>(apiRoutes.deliveryFees, body, options);
  }

  function updateOrderStatus(
    orderId: string,
    body: OrderStatusUpdateInput,
    options?: RequestConfig,
  ) {
    return patch<Order>(apiRoutes.orderById(orderId), body, options);
  }

  function updateBookingStatus(
    bookingId: string,
    body: BookingStatusUpdateInput,
    options?: RequestConfig,
  ) {
    return patch<Booking>(apiRoutes.bookingById(bookingId), body, options);
  }

  function createProfile(body: ProfilePayload, options: RequestConfig) {
    return post<Profile>("/profiles/me", body, options);
  }

  function updateAdminOrderSupport(
    orderId: string,
    body: OrderAdminSupportUpdateInput,
    options: RequestConfig,
  ) {
    return patch<OrderAdmin>(`/orders/${orderId}/admin-support`, body, options);
  }

  function updateAdminBookingSupport(
    bookingId: string,
    body: BookingAdminSupportUpdateInput,
    options: RequestConfig,
  ) {
    return patch<BookingAdmin>(`/bookings/${bookingId}/admin-support`, body, options);
  }

  function updateProfile(body: ProfileUpdateInput, options: RequestConfig) {
    return patch<Profile>("/profiles/me", body, options);
  }

  function createSellerProfile(body: SellerCreateInput, options: RequestConfig) {
    return post<SellerProfile>("/sellers", body, options);
  }

  function createListing(body: ListingCreateInput, options: RequestConfig) {
    return post<Listing>("/listings", body, options);
  }

  function updateListing(
    listingId: string,
    body: ListingUpdateInput,
    options: RequestConfig,
  ) {
    return patch<Listing>(apiRoutes.listingById(listingId), body, options);
  }

  function promoteListing(
    listingId: string,
    body: { is_promoted: boolean },
    options: RequestConfig,
  ) {
    return patch<Listing>(apiRoutes.listingPromotion(listingId), body, options);
  }

  function listPromotedListings(options?: RequestConfig) {
    return get<Listing[]>(apiRoutes.promotedListings, options);
  }

  function listPromotionSummary(options?: RequestConfig) {
    return get<ListingPromotionSummary[]>(apiRoutes.promotionSummary, options);
  }

  function listPromotionEvents(options?: RequestConfig) {
    return get<ListingPromotionEvent[]>(apiRoutes.promotionEvents, options);
  }

  function listPlatformFeeHistory(
    days?: number,
    options?: RequestConfig,
  ) {
    return get<PlatformFeeHistoryPoint[]>(
      apiRoutes.platformFeeHistory(days),
      options,
    );
  }

  function listDeliveryFeeHistory(
    days?: number,
    options?: RequestConfig,
  ) {
    return get<DeliveryFeeHistoryPoint[]>(
      apiRoutes.deliveryFeeHistory(days),
      options,
    );
  }

  function listSubscriptionTiers(options?: RequestConfig) {
    return get<SubscriptionTierRead[]>(apiRoutes.subscriptionTiers, options);
  }

  function listAdminSellers(query?: string, limit?: number, options?: RequestConfig) {
    return get<SellerLookupRead[]>(apiRoutes.adminSellers(query, limit), options);
  }

  function listAdminSellerTrustInterventions(limit?: number, options?: RequestConfig) {
    return get<SellerTrustIntervention[]>(
      apiRoutes.sellerTrustInterventions(limit),
      options,
    );
  }

  function listReviewAnomalies(limit?: number, options?: RequestConfig) {
    return get<ReviewAnomalyRead[]>(apiRoutes.reviewAnomalies(limit), options);
  }

  function listReviewAnomalySellerSummaries(limit?: number, options?: RequestConfig) {
    return get<ReviewAnomalySellerSummaryRead[]>(apiRoutes.reviewAnomalySellers(limit), options);
  }

  function acknowledgeReviewAnomaly(sellerId: string, options: RequestConfig) {
    return post<NotificationDelivery[]>(
      apiRoutes.reviewAnomalyAcknowledge(sellerId),
      { seller_id: sellerId },
      options,
    );
  }

  function clearReviewAnomalyAcknowledgement(sellerId: string, options: RequestConfig) {
    return del<NotificationDelivery[]>(apiRoutes.reviewAnomalyAcknowledge(sellerId), options);
  }

  function createSubscriptionTier(body: SubscriptionTierCreate, options: RequestConfig) {
    return post<SubscriptionTierRead>(apiRoutes.subscriptionTiers, body, options);
  }

  function listSellerSubscriptions(options?: RequestConfig) {
    return get<SellerSubscriptionRead[]>(apiRoutes.sellerSubscriptions, options);
  }

  function listSellerSubscriptionEvents(options?: RequestConfig) {
    return get<SellerSubscriptionEventRead[]>(apiRoutes.sellerSubscriptionEvents, options);
  }

  function assignSellerSubscription(body: SellerSubscriptionAssign, options: RequestConfig) {
    return post<SellerSubscriptionRead>(apiRoutes.sellerSubscriptions, body, options);
  }

  function listPricingScopeSummary(options?: RequestConfig) {
    return get<ListingPricingScopeCount[]>("/admin/listings/pricing-scope-summary", options);
  }

  function listPricingScopeItems(scope: string, options?: RequestConfig) {
    return get<Listing[]>(`/admin/listings/pricing-scope-items?scope=${encodeURIComponent(scope)}`, options);
  }

  function getListingPriceInsight(listingId: string, options: RequestConfig) {
    return get<ListingPriceInsight>(apiRoutes.listingPriceInsight(listingId), options);
  }

  function getListingBookingSuggestion(listingId: string, options?: RequestConfig) {
    return get<ListingBookingSuggestionRead>(apiRoutes.listingBookingSuggestion(listingId), options);
  }

  function assistListing(body: ListingAiAssistRequest, options: RequestConfig) {
    return post<ListingAiAssistResponse>("/listings/ai-assist", body, options);
  }

  function addListingImage(
    listingId: string,
    body: ListingImageCreateInput,
    options: RequestConfig,
  ) {
    return post<ListingImage>(apiRoutes.listingImages(listingId), body, options);
  }

  function uploadListingImage(
    listingId: string,
    body: ListingImageUploadCreateInput,
    options: RequestConfig,
  ) {
    return post<ListingImage>(apiRoutes.listingImageUpload(listingId), body, options);
  }

  function deleteListingImage(
    listingId: string,
    imageId: string,
    options: RequestConfig,
  ) {
    return del<ListingImage>(`${apiRoutes.listingImages(listingId)}/${imageId}`, options);
  }

  function createOrder(body: OrderCreateInput, options: RequestConfig) {
    return post<Order>("/orders", body, options);
  }

  function createBooking(body: BookingCreateInput, options: RequestConfig) {
    return post<Booking>("/bookings", body, options);
  }

  function createReview(body: ReviewCreateInput, options: RequestConfig) {
    return post<ReviewRead>("/reviews", body, options);
  }

  function updateReviewSellerResponse(
    reviewId: string,
    body: ReviewSellerResponseUpdateInput,
    options: RequestConfig,
  ) {
    return patch<ReviewRead>(apiRoutes.reviewSellerResponse(reviewId), body, options);
  }

  function requestReviewResponseAiAssist(reviewId: string, options: RequestConfig) {
    return post<ReviewResponseAiAssistResponse>(apiRoutes.reviewResponseAiAssist(reviewId), undefined, options);
  }

  function requestOrderResponseAiAssist(orderId: string, options: RequestConfig) {
    return post<OrderResponseAiAssistResponse>(apiRoutes.orderResponseAiAssist(orderId), undefined, options);
  }

  function requestBookingResponseAiAssist(bookingId: string, options: RequestConfig) {
    return post<BookingResponseAiAssistResponse>(
      apiRoutes.bookingResponseAiAssist(bookingId),
      undefined,
      options,
    );
  }

  function createReviewReport(
    reviewId: string,
    body: ReviewReportCreateInput,
    options: RequestConfig,
  ) {
    return post<ReviewReportRead>(apiRoutes.reviewReport(reviewId), body, options);
  }

  function listAdminReviewReports(
    accessToken: string,
    status: "all" | "open" | "triaged" | "resolved" = "all",
  ) {
    return get<ReviewModerationItem[]>(`/reviews/reports?status=${status}`, { accessToken });
  }

  function updateReviewVisibility(
    reviewId: string,
    body: ReviewVisibilityUpdateInput,
    options: RequestConfig,
  ) {
    return patch<ReviewRead>(apiRoutes.reviewVisibility(reviewId), body, options);
  }

  async function loadPublicListingsPage(
    params: PublicListingsPageParams = {},
    options?: RequestConfig,
  ) {
    const searchParams = new URLSearchParams();
    if (typeof params.limit === "number") {
      searchParams.set("limit", String(params.limit));
    }
    if (typeof params.offset === "number") {
      searchParams.set("offset", String(params.offset));
    }
    const response = await get<ListingResponse>(
      `/listings${searchParams.toString() ? `?${searchParams.toString()}` : ""}`,
      options,
    );
    return response.items;
  }

  async function loadMyProfile(accessToken: string): Promise<Profile> {
    return get<Profile>("/profiles/me", { accessToken });
  }

  async function loadBuyerEngagementContext(accessToken: string): Promise<BuyerEngagementContext> {
    const [orders, bookings] = await Promise.all([
      get<Order[]>("/orders/me", { accessToken }),
      get<Booking[]>("/bookings/me", { accessToken }),
    ]);

    return {
      orders,
      bookings,
    };
  }

  async function loadSellerWorkspace(accessToken: string): Promise<SellerWorkspaceData | null> {
    let seller: SellerProfile | null = null;
    try {
      seller = await get<SellerProfile>("/sellers/me", { accessToken });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) {
        throw error;
      }
    }

    if (!seller) {
      return null;
    }

    const [listings, orders, bookings, reviews, subscription] = await Promise.all([
      get<Listing[]>("/listings/me", { accessToken }),
      get<Order[]>("/orders/seller", { accessToken }),
      get<Booking[]>("/bookings/seller", { accessToken }),
      getSellerReviewsBySlug(seller.slug, { accessToken }).catch(() => []),
      getMySellerSubscription({ accessToken }),
    ]);

    return {
      seller,
      subscription,
      listings,
      orders,
      bookings,
      reviews,
    };
  }

  async function loadAdminTransactions(accessToken: string): Promise<AdminTransactionsData> {
    const [orders, bookings, admins, deliveries, listings] = await Promise.all([
      get<OrderAdmin[]>("/orders/admin", { accessToken }),
      get<BookingAdmin[]>("/bookings/admin", { accessToken }),
      get<AdminUser[]>("/admin/users", { accessToken }),
      get<NotificationDelivery[]>("/notifications/admin", { accessToken }),
      get<Listing[]>("/listings/admin", { accessToken }),
    ]);

    return {
      orders,
      bookings,
      admins,
      deliveries,
      listings,
    };
  }

  async function loadAdminNotificationDeliveries(accessToken: string): Promise<AdminDeliveriesData> {
    const [admins, deliveries, summary, workerHealth] = await Promise.all([
      get<AdminUser[]>("/admin/users", { accessToken }),
      get<NotificationDelivery[]>("/notifications/admin", { accessToken }),
      get<NotificationDeliverySummary>("/notifications/admin/summary", { accessToken }).catch((error) => {
        if (error instanceof ApiError && error.status === 404) {
          return null;
        }
        throw error;
      }),
      get<NotificationWorkerHealth>("/notifications/admin/worker-health", { accessToken }).catch((error) => {
        if (error instanceof ApiError && error.status === 404) {
          return null;
        }
        throw error;
      }),
    ]);

    return {
      admins,
      deliveries,
      summary,
      workerHealth,
    };
  }

  function loadMyNotificationDeliveries(accessToken: string) {
    return get<NotificationDelivery[]>("/notifications/me", { accessToken });
  }

  function retryNotificationDelivery(deliveryId: string, accessToken: string) {
    return post<NotificationDelivery>(`/notifications/${deliveryId}/retry`, undefined, {
      accessToken,
    });
  }

  function retryAdminNotificationDelivery(deliveryId: string, accessToken: string) {
    return post<NotificationDelivery>(`/notifications/admin/${deliveryId}/retry`, undefined, {
      accessToken,
    });
  }

  function bulkRetryAdminNotificationDeliveries(
    deliveryIds: string[],
    accessToken: string,
    executionMode: "best_effort" | "atomic" = "best_effort",
  ) {
    return post<NotificationDeliveryBulkRetryResult>("/notifications/admin/bulk-retry", {
      delivery_ids: deliveryIds,
      execution_mode: executionMode,
    } satisfies NotificationDeliveryBulkRetryRequest, {
      accessToken,
    });
  }

  function bulkRetryNotificationDeliveries(
    deliveryIds: string[],
    accessToken: string,
    executionMode: "best_effort" | "atomic" = "best_effort",
  ) {
    return post<NotificationDeliveryBulkRetryResult>("/notifications/bulk-retry", {
      delivery_ids: deliveryIds,
      execution_mode: executionMode,
    } satisfies NotificationDeliveryBulkRetryRequest, {
      accessToken,
    });
  }

  function bulkUpdateOrderStatuses(
    body: OrderBulkStatusUpdateRequest,
    options: RequestConfig,
  ) {
    return post<OrderBulkStatusUpdateResult>("/orders/bulk-status", body, options);
  }

  function bulkUpdateBookingStatuses(
    body: BookingBulkStatusUpdateRequest,
    options: RequestConfig,
  ) {
    return post<BookingBulkStatusUpdateResult>("/bookings/bulk-status", body, options);
  }

  return {
    get,
    post,
    patch,
    getSellerBySlug,
    getSellerById,
    getSellerListingSummaryBySlug,
    getSellerListingsBySlug,
    listCategories,
    getSellerReviewsBySlug,
    getSellerSubscriptionBySlug,
    getMySellerSubscription,
    acknowledgeAdminTrustAlert,
    clearAdminTrustAlertAcknowledgement,
    listAdminTrustAlertEvents,
    listAdminTrustAlertSellerSummaries,
    getMyReviewLookup,
    getListingById,
    getListingPriceInsight,
    getListingBookingSuggestion,
    getOrderById,
    getBookingById,
    getPlatformFees,
    getDeliveryFees,
    createPlatformFeeRate,
    createDeliveryFees,
    updateOrderStatus,
    updateBookingStatus,
    updateAdminOrderSupport,
    updateAdminBookingSupport,
    createProfile,
    updateProfile,
    createSellerProfile,
    createListing,
    updateListing,
    promoteListing,
    assistListing,
    addListingImage,
    uploadListingImage,
    deleteListingImage,
    createOrder,
    createBooking,
    createReview,
    createReviewReport,
    listAdminReviewReports,
    updateReviewSellerResponse,
    requestReviewResponseAiAssist,
    requestOrderResponseAiAssist,
    requestBookingResponseAiAssist,
    updateReviewVisibility,
    loadPublicListingsPage,
    loadBuyerEngagementContext,
    loadSellerWorkspace,
    listPromotedListings,
    listPromotionSummary,
    listPromotionEvents,
    listPlatformFeeHistory,
    listDeliveryFeeHistory,
    listAdminSellers,
    listAdminSellerTrustInterventions,
    listReviewAnomalies,
    listReviewAnomalySellerSummaries,
    acknowledgeReviewAnomaly,
    clearReviewAnomalyAcknowledgement,
    listSubscriptionTiers,
    createSubscriptionTier,
    listSellerSubscriptions,
    listSellerSubscriptionEvents,
    assignSellerSubscription,
    listPricingScopeSummary,
    listPricingScopeItems,
    loadAdminTransactions,
    loadAdminNotificationDeliveries,
    loadMyProfile,
    loadMyNotificationDeliveries,
    retryNotificationDelivery,
    retryAdminNotificationDelivery,
    bulkRetryAdminNotificationDeliveries,
    bulkRetryNotificationDeliveries,
    bulkUpdateOrderStatuses,
    bulkUpdateBookingStatuses,
  };
}

export function formatCurrency(
  amountInCents: number | null | undefined,
  currency: string | null | undefined,
) {
  if (amountInCents == null) {
    return "Custom quote";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency ?? "USD",
  }).format(amountInCents / 100);
}

export function formatLocation(location: {
  city?: string | null;
  state?: string | null;
  country?: string | null;
}) {
  return [location.city, location.state, location.country].filter(Boolean).join(", ");
}

function shouldIncludeNotification(
  audience: NotificationAudience,
  actorRole: string | null | undefined,
) {
  if (audience === "buyer") {
    return actorRole === "seller";
  }

  return actorRole === "buyer";
}

function formatNotificationTitle(
  audience: NotificationAudience,
  transactionKind: "order" | "booking",
  status: string,
) {
  if (audience === "seller" && transactionKind === "order" && status === "pending") {
    return "New order received";
  }

  if (audience === "seller" && transactionKind === "booking" && status === "requested") {
    return "New booking request";
  }

  return `${transactionKind === "order" ? "Order" : "Booking"} ${status.replaceAll("_", " ")}`;
}

function formatNotificationMessage(
  transactionKind: "order" | "booking",
  status: string,
  note: string | null | undefined,
) {
  if (note) {
    return note;
  }

  if (transactionKind === "order") {
    return `Order moved to ${status.replaceAll("_", " ")}.`;
  }

  return `Booking moved to ${status.replaceAll("_", " ")}.`;
}

export function buildNotifications(params: {
  audience: NotificationAudience;
  orders: Order[];
  bookings: Booking[];
}): NotificationItem[] {
  const { audience, orders, bookings } = params;

  const orderNotifications = orders.flatMap((order) =>
    (order.status_history ?? [])
      .filter((event) => shouldIncludeNotification(audience, event.actor_role))
      .map((event) => ({
        id: `order-${event.id}`,
        transactionKind: "order" as const,
        transactionId: order.id,
        status: event.status,
        actorRole: event.actor_role,
        note: event.note ?? null,
        createdAt: event.created_at,
        title: formatNotificationTitle(audience, "order", event.status),
        message: formatNotificationMessage("order", event.status, event.note),
      })),
  );

  const bookingNotifications = bookings.flatMap((booking) =>
    (booking.status_history ?? [])
      .filter((event) => shouldIncludeNotification(audience, event.actor_role))
      .map((event) => ({
        id: `booking-${event.id}`,
        transactionKind: "booking" as const,
        transactionId: booking.id,
        status: event.status,
        actorRole: event.actor_role,
        note: event.note ?? null,
        createdAt: event.created_at,
        title: formatNotificationTitle(audience, "booking", event.status),
        message: formatNotificationMessage("booking", event.status, event.note),
      })),
  );

  return [...orderNotifications, ...bookingNotifications].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}
