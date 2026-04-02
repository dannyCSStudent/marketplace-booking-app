import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function resolveProjectId() {
  return (
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null
  );
}

export async function getExpoPushToken() {
  if (Platform.OS === 'web') {
    return null;
  }

  if (!Device.isDevice) {
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
