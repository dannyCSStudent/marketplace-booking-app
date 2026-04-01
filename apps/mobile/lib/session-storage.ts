import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const BUYER_TOKEN_KEY = 'buyer_access_token';
const BUYER_NOTIFICATIONS_SEEN_AT_KEY = 'buyer_notifications_seen_at';

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

export async function clearBuyerAccessToken() {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(BUYER_TOKEN_KEY);
    return;
  }

  await AsyncStorage.removeItem(BUYER_TOKEN_KEY);
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
