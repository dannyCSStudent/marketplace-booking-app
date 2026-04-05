import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  addPushNotificationResponseListener,
  getLastPushNotificationData,
} from '@/lib/push-notifications';
import { BuyerSessionProvider, useBuyerSession } from '@/providers/buyer-session';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <BuyerSessionProvider>
        <NotificationRoutingBridge />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="listings/[id]"
            options={{
              title: 'Listing',
              headerBackTitle: 'Back',
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen
            name="transactions/[kind]/[id]"
            options={{
              title: 'Receipt',
              headerBackTitle: 'Back',
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen
            name="notifications/[id]"
            options={{
              title: 'Delivery Detail',
              headerBackTitle: 'Back',
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="auto" />
      </BuyerSessionProvider>
    </ThemeProvider>
  );
}

function NotificationRoutingBridge() {
  const router = useRouter();
  const lastTargetRef = useRef<string | null>(null);
  const { notifications, markNotificationsSeen } = useBuyerSession();

  useEffect(() => {
    async function navigateFromNotificationData(data: Record<string, unknown> | null) {
      if (!data) {
        return;
      }

      if (notifications.length > 0) {
        await markNotificationsSeen();
      }

      const transactionKind =
        typeof data.transaction_kind === 'string' ? data.transaction_kind : null;
      const transactionId =
        typeof data.transaction_id === 'string' ? data.transaction_id : null;

      if (!transactionKind || !transactionId || transactionId === 'test') {
        const fallbackTarget = '/(tabs)/explore';
        if (lastTargetRef.current === fallbackTarget) {
          return;
        }
        lastTargetRef.current = fallbackTarget;
        router.push(fallbackTarget);
        return;
      }

      const target = `/transactions/${transactionKind}/${transactionId}`;
      if (lastTargetRef.current === target) {
        return;
      }

      lastTargetRef.current = target;
      router.push({
        pathname: '/transactions/[kind]/[id]',
        params: {
          kind: transactionKind,
          id: transactionId,
        },
      });
    }

    void (async () => {
      const initialData = await getLastPushNotificationData();
      await navigateFromNotificationData(initialData);
    })();

    let subscription: { remove: () => void } | null = null;
    void (async () => {
      subscription = await addPushNotificationResponseListener((data) => {
        void navigateFromNotificationData(data);
      });
    })();

    return () => {
      subscription?.remove();
    };
  }, [markNotificationsSeen, notifications.length, router]);

  return null;
}
