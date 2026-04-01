import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { BuyerSessionProvider } from '@/providers/buyer-session';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <BuyerSessionProvider>
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
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="auto" />
      </BuyerSessionProvider>
    </ThemeProvider>
  );
}
