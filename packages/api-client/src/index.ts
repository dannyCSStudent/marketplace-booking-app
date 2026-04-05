import type { ApiOperations, ApiSchemaMap } from "./generated/openapi";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type HttpMethod = "get" | "post" | "patch";
type KnownPath = keyof ApiOperations;

type PathsForMethod<Method extends HttpMethod> = {
  [Path in KnownPath]: Method extends keyof ApiOperations[Path] ? Path : never;
}[KnownPath];

type ResponseFor<Path extends KnownPath, Method extends keyof ApiOperations[Path]> =
  ApiOperations[Path][Method] extends { response: infer Response } ? Response : never;

type RequestBodyFor<Path extends KnownPath, Method extends keyof ApiOperations[Path]> =
  ApiOperations[Path][Method] extends { requestBody: infer Body } ? Body : never;

export type Listing = ApiSchemaMap["ListingRead"];
export type ListingResponse = ApiSchemaMap["ListingListResponse"];
export type Booking = ApiSchemaMap["BookingRead"];
export type Order = ApiSchemaMap["OrderRead"];
export type Profile = ApiSchemaMap["ProfileRead"];
export type SellerProfile = ApiSchemaMap["SellerRead"];
export type ProfilePayload = ApiSchemaMap["ProfileCreate"];
export type ProfileUpdateInput = ApiSchemaMap["ProfileUpdate"];
export type BookingCreateInput = ApiSchemaMap["BookingCreate"];
export type BookingStatusUpdateInput = ApiSchemaMap["BookingStatusUpdate"];
export type ListingCreateInput = ApiSchemaMap["ListingCreate"];
export type ListingUpdateInput = ApiSchemaMap["ListingUpdate"];
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
export type ApiSchemas = ApiSchemaMap;
export type BuyerDashboardData = {
  listings: Listing[];
  profile: Profile;
  orders: Order[];
  bookings: Booking[];
};
export type SellerWorkspaceData = {
  seller: SellerProfile;
  listings: Listing[];
  orders: Order[];
  bookings: Booking[];
};
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
  method?: "GET" | "POST" | "PATCH";
  accessToken?: string;
  body?: unknown;
  cache?: RequestCache;
};

type RequestConfig = Omit<RequestOptions, "method" | "body">;

export function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

export const apiRoutes = {
  sellerBySlug: (slug: string) => `/sellers/${slug}`,
  listingById: (listingId: string) => `/listings/${listingId}`,
  listingImages: (listingId: string) => `/listings/${listingId}/images`,
  orderById: (orderId: string) => `/orders/${orderId}`,
  bookingById: (bookingId: string) => `/bookings/${bookingId}`,
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

  function getSellerBySlug(slug: string, options?: RequestConfig) {
    return get<SellerProfile>(apiRoutes.sellerBySlug(slug), options);
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

  function createOrder(body: OrderCreateInput, options: RequestConfig) {
    return post<Order>("/orders", body, options);
  }

  function createBooking(body: BookingCreateInput, options: RequestConfig) {
    return post<Booking>("/bookings", body, options);
  }

  async function loadPublicListings(options?: RequestConfig) {
    const response = await get<ListingResponse>("/listings", options);
    return response.items;
  }

  async function loadBuyerDashboard(accessToken: string): Promise<BuyerDashboardData> {
    const [listingResponse, profile, orders, bookings] = await Promise.all([
      get<ListingResponse>("/listings"),
      get<Profile>("/profiles/me", { accessToken }),
      get<Order[]>("/orders/me", { accessToken }),
      get<Booking[]>("/bookings/me", { accessToken }),
    ]);

    return {
      listings: listingResponse.items,
      profile,
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

    const [listings, orders, bookings] = await Promise.all([
      get<Listing[]>("/listings/me", { accessToken }),
      get<Order[]>("/orders/seller", { accessToken }),
      get<Booking[]>("/bookings/seller", { accessToken }),
    ]);

    return {
      seller,
      listings,
      orders,
      bookings,
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
    getListingById,
    getOrderById,
    getBookingById,
    updateOrderStatus,
    updateBookingStatus,
    createProfile,
    updateProfile,
    createSellerProfile,
    createListing,
    updateListing,
    createOrder,
    createBooking,
    loadPublicListings,
    loadBuyerDashboard,
    loadSellerWorkspace,
    loadMyNotificationDeliveries,
    retryNotificationDelivery,
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
