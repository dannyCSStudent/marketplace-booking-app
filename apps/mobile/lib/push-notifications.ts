import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

let notificationHandlerConfigured = false;

function canUseExpoPushNotifications() {
  if (Platform.OS === 'web') {
    return false;
  }

  return Constants.executionEnvironment !== 'storeClient';
}

function resolveProjectId() {
  return (
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null
  );
}

async function getNotificationsModule() {
  if (!canUseExpoPushNotifications()) {
    return null;
  }

  const Notifications = await import('expo-notifications');

  if (!notificationHandlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    notificationHandlerConfigured = true;
  }

  return Notifications;
}

export async function getExpoPushToken() {
  if (!canUseExpoPushNotifications()) {
    return null;
  }

  if (!Device.isDevice) {
    return null;
  }

  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return null;
  }

  const permissionState = await Notifications.getPermissionsAsync();
  let finalStatus = permissionState.status;

  if (finalStatus !== 'granted') {
    const permissionRequest = await Notifications.requestPermissionsAsync();
    finalStatus = permissionRequest.status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    return null;
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}
