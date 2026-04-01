import {
  ApiError,
  buildNotifications,
  createApiClient,
  type BuyerDashboardData,
  formatCurrency,
  formatLocation,
  type Booking,
  type BookingCreateInput,
  type Listing,
  type ListingResponse,
  type NotificationItem,
  type Order,
  type OrderCreateInput,
  type Profile,
  type ProfilePayload,
  type ProfileUpdateInput,
  type SellerProfile,
} from '@repo/api-client';
export { formatCurrency, formatLocation } from '@repo/api-client';
import { Platform } from 'react-native';
import { authenticateWithSupabase } from '@repo/auth';

export type BuyerSession = {
  access_token: string;
};

function resolveApiBaseUrl() {
  const configuredUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

  if (configuredUrl) {
    if (Platform.OS === 'web') {
      return configuredUrl
        .replace('10.0.2.2', '127.0.0.1')
        .replace('localhost', '127.0.0.1');
    }

    if (Platform.OS === 'android') {
      return configuredUrl
        .replace('127.0.0.1', '10.0.2.2')
        .replace('localhost', '10.0.2.2');
    }

    return configuredUrl;
  }

  if (Platform.OS === 'web') {
    return 'http://127.0.0.1:8000';
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8000';
  }

  return 'http://127.0.0.1:8000';
}

const apiBaseUrl = resolveApiBaseUrl();
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const api = createApiClient(apiBaseUrl);
export { createApiClient };
export type {
  Booking,
  BookingCreateInput,
  BuyerDashboardData,
  Listing,
  ListingResponse,
  NotificationItem,
  Order,
  OrderCreateInput,
  Profile,
  ProfilePayload,
  ProfileUpdateInput,
  SellerProfile,
};
export { ApiError };
export { buildNotifications };

export async function fetchApi<T>(
  path: string,
  init?: { method?: 'GET' | 'POST' | 'PATCH'; accessToken?: string; body?: unknown },
) {
  const method = init?.method ?? 'GET';
  if (method === 'POST') {
    return api.post<T>(path, init?.body, { accessToken: init?.accessToken });
  }
  if (method === 'PATCH') {
    return api.patch<T>(path, init?.body, { accessToken: init?.accessToken });
  }
  return api.get<T>(path, { accessToken: init?.accessToken });
}

export async function signInBuyer(email: string, password: string): Promise<BuyerSession> {
  return authenticateWithSupabase({
    mode: 'sign-in',
    email,
    password,
    config: {
      supabaseUrl,
      anonKey: supabaseAnonKey,
    },
  });
}

export async function signUpBuyer(email: string, password: string): Promise<BuyerSession> {
  return authenticateWithSupabase({
    mode: 'sign-up',
    email,
    password,
    config: {
      supabaseUrl,
      anonKey: supabaseAnonKey,
    },
  });
}

export function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

export function createBuyerProfile(accessToken: string, profile: ProfilePayload) {
  return api.createProfile(profile, { accessToken });
}

export function updateBuyerProfile(accessToken: string, profile: ProfileUpdateInput) {
  return api.updateProfile(profile, { accessToken });
}

export function createBuyerOrder(accessToken: string, input: OrderCreateInput) {
  return api.createOrder(input, { accessToken });
}

export function createBuyerBooking(accessToken: string, input: BookingCreateInput) {
  return api.createBooking(input, { accessToken });
}

export function loadBuyerDashboard(accessToken: string) {
  return api.loadBuyerDashboard(accessToken);
}

export function loadPublicListings() {
  return api.loadPublicListings();
}

export function formatBuyerActionError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'Sign in again before placing an order or requesting a booking.';
    }

    if (error.message.includes('does not support')) {
      const method = error.message.split('does not support ')[1];
      return method
        ? `This listing does not offer ${method}. Choose one of the enabled fulfillment options instead.`
        : 'This listing does not support the selected fulfillment method.';
    }

    if (error.message.includes('Service listings must be booked')) {
      return 'This seller only accepts booking requests for this listing.';
    }

    if (error.message.includes('lead time of')) {
      return error.message.replace(
        'Booking must respect the seller ',
        'This seller needs ',
      );
    }

    if (error.message.includes('Booking duration must be exactly')) {
      return error.message.replace('Booking duration must be exactly', 'This service must be booked for exactly');
    }

    if (error.message.includes('does not accept bookings')) {
      return 'This listing is not accepting booking requests right now.';
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to complete this request right now.';
}

export function getApiBaseUrl() {
  return apiBaseUrl;
}
