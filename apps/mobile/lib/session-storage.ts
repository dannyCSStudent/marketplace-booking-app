import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const BUYER_TOKEN_KEY = 'buyer_access_token';
const BUYER_REFRESH_TOKEN_KEY = 'buyer_refresh_token';
const BUYER_NOTIFICATIONS_SEEN_AT_KEY = 'buyer_notifications_seen_at';
const BUYER_WORKSPACE_FILTERS_KEY = 'buyer_workspace_filters';
const BUYER_WORKSPACE_RESUME_KEY = 'buyer_workspace_resume';
const BUYER_DELIVERY_RETRY_MODE_KEY = 'buyer_delivery_retry_mode';
const BUYER_RECENT_NOTIFICATION_DELIVERIES_KEY = 'buyer_recent_notification_deliveries';
const BUYER_RECENT_TRANSACTION_RECEIPTS_KEY = 'buyer_recent_transaction_receipts';
const BUYER_BROWSE_FILTERS_KEY = 'buyer_browse_filters';
const BUYER_BROWSE_RESUME_KEY = 'buyer_browse_resume';
const BUYER_RECENT_LISTINGS_KEY = 'buyer_recent_listings';

export async function getBuyerAccessToken() {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(BUYER_TOKEN_KEY);
  }

  return AsyncStorage.getItem(BUYER_TOKEN_KEY);
}

export async function setBuyerAccessToken(token: string) {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(BUYER_TOKEN_KEY, token);
    return;
  }

  await AsyncStorage.setItem(BUYER_TOKEN_KEY, token);
}

export async function getBuyerRefreshToken() {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(BUYER_REFRESH_TOKEN_KEY);
  }

  return AsyncStorage.getItem(BUYER_REFRESH_TOKEN_KEY);
}

export async function setBuyerRefreshToken(token: string) {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(BUYER_REFRESH_TOKEN_KEY, token);
    return;
  }

  await AsyncStorage.setItem(BUYER_REFRESH_TOKEN_KEY, token);
}

export async function clearBuyerAccessToken() {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(BUYER_TOKEN_KEY);
    return;
  }

  await AsyncStorage.removeItem(BUYER_TOKEN_KEY);
}

export async function clearBuyerRefreshToken() {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(BUYER_REFRESH_TOKEN_KEY);
    return;
  }

  await AsyncStorage.removeItem(BUYER_REFRESH_TOKEN_KEY);
}

export async function getBuyerNotificationsSeenAt() {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(BUYER_NOTIFICATIONS_SEEN_AT_KEY);
  }

  return AsyncStorage.getItem(BUYER_NOTIFICATIONS_SEEN_AT_KEY);
}

export async function setBuyerNotificationsSeenAt(value: string) {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(BUYER_NOTIFICATIONS_SEEN_AT_KEY, value);
    return;
  }

  await AsyncStorage.setItem(BUYER_NOTIFICATIONS_SEEN_AT_KEY, value);
}

export async function clearBuyerNotificationsSeenAt() {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(BUYER_NOTIFICATIONS_SEEN_AT_KEY);
    return;
  }

  await AsyncStorage.removeItem(BUYER_NOTIFICATIONS_SEEN_AT_KEY);
}

export async function getBuyerWorkspaceFilters() {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(BUYER_WORKSPACE_FILTERS_KEY);
  }

  return AsyncStorage.getItem(BUYER_WORKSPACE_FILTERS_KEY);
}

export async function setBuyerWorkspaceFilters(value: string) {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(BUYER_WORKSPACE_FILTERS_KEY, value);
    return;
  }

  await AsyncStorage.setItem(BUYER_WORKSPACE_FILTERS_KEY, value);
}

export async function getBuyerWorkspaceResumeFilters() {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(BUYER_WORKSPACE_RESUME_KEY);
  }

  return AsyncStorage.getItem(BUYER_WORKSPACE_RESUME_KEY);
}

export async function setBuyerWorkspaceResumeFilters(value: string) {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(BUYER_WORKSPACE_RESUME_KEY, value);
    return;
  }

  await AsyncStorage.setItem(BUYER_WORKSPACE_RESUME_KEY, value);
}

export async function clearBuyerWorkspaceResumeFilters() {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(BUYER_WORKSPACE_RESUME_KEY);
    return;
  }

  await AsyncStorage.removeItem(BUYER_WORKSPACE_RESUME_KEY);
}

export async function getBuyerDeliveryRetryMode() {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(BUYER_DELIVERY_RETRY_MODE_KEY);
  }

  return AsyncStorage.getItem(BUYER_DELIVERY_RETRY_MODE_KEY);
}

export async function setBuyerDeliveryRetryMode(value: 'best_effort' | 'atomic') {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(BUYER_DELIVERY_RETRY_MODE_KEY, value);
    return;
  }

  await AsyncStorage.setItem(BUYER_DELIVERY_RETRY_MODE_KEY, value);
}

export async function getBuyerBrowseFilters() {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(BUYER_BROWSE_FILTERS_KEY);
  }

  return AsyncStorage.getItem(BUYER_BROWSE_FILTERS_KEY);
}

export async function setBuyerBrowseFilters(value: string) {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(BUYER_BROWSE_FILTERS_KEY, value);
    return;
  }

  await AsyncStorage.setItem(BUYER_BROWSE_FILTERS_KEY, value);
}

export async function getBuyerBrowseResumeFilters() {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(BUYER_BROWSE_RESUME_KEY);
  }

  return AsyncStorage.getItem(BUYER_BROWSE_RESUME_KEY);
}

export async function setBuyerBrowseResumeFilters(value: string) {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(BUYER_BROWSE_RESUME_KEY, value);
    return;
  }

  await AsyncStorage.setItem(BUYER_BROWSE_RESUME_KEY, value);
}

export async function clearBuyerBrowseResumeFilters() {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(BUYER_BROWSE_RESUME_KEY);
    return;
  }

  await AsyncStorage.removeItem(BUYER_BROWSE_RESUME_KEY);
}

export async function getBuyerRecentListings() {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(BUYER_RECENT_LISTINGS_KEY);
  }

  return AsyncStorage.getItem(BUYER_RECENT_LISTINGS_KEY);
}

export async function setBuyerRecentListings(value: string) {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(BUYER_RECENT_LISTINGS_KEY, value);
    return;
  }

  await AsyncStorage.setItem(BUYER_RECENT_LISTINGS_KEY, value);
}

export async function getBuyerRecentNotificationDeliveries() {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(BUYER_RECENT_NOTIFICATION_DELIVERIES_KEY);
  }

  return AsyncStorage.getItem(BUYER_RECENT_NOTIFICATION_DELIVERIES_KEY);
}

export async function setBuyerRecentNotificationDeliveries(value: string) {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(BUYER_RECENT_NOTIFICATION_DELIVERIES_KEY, value);
    return;
  }

  await AsyncStorage.setItem(BUYER_RECENT_NOTIFICATION_DELIVERIES_KEY, value);
}

export async function clearBuyerRecentNotificationDeliveries() {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(BUYER_RECENT_NOTIFICATION_DELIVERIES_KEY);
    return;
  }

  await AsyncStorage.removeItem(BUYER_RECENT_NOTIFICATION_DELIVERIES_KEY);
}

export async function getBuyerRecentTransactionReceipts() {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(BUYER_RECENT_TRANSACTION_RECEIPTS_KEY);
  }

  return AsyncStorage.getItem(BUYER_RECENT_TRANSACTION_RECEIPTS_KEY);
}

export async function setBuyerRecentTransactionReceipts(value: string) {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(BUYER_RECENT_TRANSACTION_RECEIPTS_KEY, value);
    return;
  }

  await AsyncStorage.setItem(BUYER_RECENT_TRANSACTION_RECEIPTS_KEY, value);
}

export async function clearBuyerRecentTransactionReceipts() {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(BUYER_RECENT_TRANSACTION_RECEIPTS_KEY);
    return;
  }

  await AsyncStorage.removeItem(BUYER_RECENT_TRANSACTION_RECEIPTS_KEY);
}
