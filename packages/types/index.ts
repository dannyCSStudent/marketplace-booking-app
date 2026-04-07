export type UUID = string;
export type ISODateString = string;

export type AccountRole = "buyer" | "seller" | "both" | "admin";

export type ListingType = "product" | "service" | "hybrid";

export type ListingStatus =
  | "draft"
  | "active"
  | "paused"
  | "sold_out"
  | "archived";

export type FulfillmentMethod =
  | "pickup"
  | "meetup"
  | "delivery"
  | "shipping";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "completed"
  | "canceled"
  | "refunded";

export type BookingStatus =
  | "requested"
  | "confirmed"
  | "declined"
  | "in_progress"
  | "completed"
  | "canceled"
  | "no_show";

export interface Profile {
  id: UUID;
  username: string | null;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: AccountRole;
  city: string | null;
  state: string | null;
  country: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface SellerProfile {
  id: UUID;
  user_id: UUID;
  display_name: string;
  slug: string;
  bio: string | null;
  is_verified: boolean;
  accepts_custom_orders: boolean;
  average_rating: number;
  review_count: number;
  city: string | null;
  state: string | null;
  country: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface Category {
  id: UUID;
  name: string;
  slug: string;
  parent_id: UUID | null;
  created_at: ISODateString;
}

export interface Listing {
  id: UUID;
  seller_id: UUID;
  category_id: UUID | null;
  title: string;
  slug: string;
  description: string | null;
  type: ListingType;
  status: ListingStatus;
  price_cents: number | null;
  currency: string;
  inventory_count: number | null;
  requires_booking: boolean;
  duration_minutes: number | null;
  is_local_only: boolean;
  city: string | null;
  state: string | null;
  country: string | null;
  pickup_enabled: boolean;
  meetup_enabled: boolean;
  delivery_enabled: boolean;
  shipping_enabled: boolean;
  is_promoted: boolean;
  lead_time_hours: number | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface ListingImage {
  id: UUID;
  listing_id: UUID;
  image_url: string;
  alt_text: string | null;
  sort_order: number;
  created_at: ISODateString;
}

export interface Address {
  id: UUID;
  user_id: UUID;
  label: string | null;
  recipient_name: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postal_code: string | null;
  country: string;
  created_at: ISODateString;
}

export interface Order {
  id: UUID;
  buyer_id: UUID;
  seller_id: UUID;
  status: OrderStatus;
  fulfillment: FulfillmentMethod;
  subtotal_cents: number;
  delivery_fee_cents: number;
  platform_fee_cents: number;
  platform_fee_rate: number;
  total_cents: number;
  currency: string;
  notes: string | null;
  delivery_address_id: UUID | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface OrderItem {
  id: UUID;
  order_id: UUID;
  listing_id: UUID;
  quantity: number;
  unit_price_cents: number;
  total_price_cents: number;
  created_at: ISODateString;
}

export interface Booking {
  id: UUID;
  buyer_id: UUID;
  seller_id: UUID;
  listing_id: UUID;
  status: BookingStatus;
  scheduled_start: ISODateString;
  scheduled_end: ISODateString;
  total_cents: number | null;
  currency: string;
  notes: string | null;
  platform_fee_cents: number;
  platform_fee_rate: number;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface Review {
  id: UUID;
  reviewer_id: UUID;
  seller_id: UUID;
  order_id: UUID | null;
  booking_id: UUID | null;
  rating: number;
  comment: string | null;
  created_at: ISODateString;
}

export interface Favorite {
  user_id: UUID;
  listing_id: UUID;
  created_at: ISODateString;
}

/**
 * API DTOs
 */

export interface UpsertProfileInput {
  username?: string | null;
  full_name?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export interface CreateSellerProfileInput {
  display_name: string;
  slug: string;
  bio?: string | null;
  accepts_custom_orders?: boolean;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export interface UpdateSellerProfileInput {
  display_name?: string;
  slug?: string;
  bio?: string | null;
  accepts_custom_orders?: boolean;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export interface CreateListingInput {
  seller_id: UUID;
  category_id?: UUID | null;
  title: string;
  description?: string | null;
  type: ListingType;
  price_cents?: number | null;
  currency?: string;
  inventory_count?: number | null;
  requires_booking?: boolean;
  duration_minutes?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  pickup_enabled?: boolean;
  meetup_enabled?: boolean;
  delivery_enabled?: boolean;
  shipping_enabled?: boolean;
  lead_time_hours?: number | null;
}

export interface UpdateListingInput {
  category_id?: UUID | null;
  title?: string;
  description?: string | null;
  type?: ListingType;
  status?: ListingStatus;
  price_cents?: number | null;
  currency?: string;
  inventory_count?: number | null;
  requires_booking?: boolean;
  duration_minutes?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  pickup_enabled?: boolean;
  meetup_enabled?: boolean;
  delivery_enabled?: boolean;
  shipping_enabled?: boolean;
  lead_time_hours?: number | null;
}

export interface CreateOrderItemInput {
  listing_id: UUID;
  quantity: number;
}

export interface CreateOrderInput {
  seller_id: UUID;
  fulfillment: FulfillmentMethod;
  notes?: string | null;
  delivery_address_id?: UUID | null;
  items: CreateOrderItemInput[];
}

export interface UpdateOrderInput {
  status?: OrderStatus;
  notes?: string | null;
  delivery_address_id?: UUID | null;
}

export interface CreateBookingInput {
  seller_id: UUID;
  listing_id: UUID;
  scheduled_start: ISODateString;
  scheduled_end: ISODateString;
  notes?: string | null;
}

export interface UpdateBookingInput {
  status?: BookingStatus;
  scheduled_start?: ISODateString;
  scheduled_end?: ISODateString;
  notes?: string | null;
}

export interface CreateListingImageInput {
  image_url: string;
  alt_text?: string | null;
  sort_order?: number;
}
