import '../global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isBooxDevice } from 'device-info';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Provider as JotaiProvider } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';
import { queryClientAtom } from 'jotai-tanstack-query';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { SafeAreaListener, SafeAreaProvider } from 'react-native-safe-area-context';
import { Uniwind } from 'uniwind';
import { UnsupportedDeviceScreen } from '@/features/device-gate/components/unsupported-device-screen';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      onSuccess: () => {
        queryClient.invalidateQueries();
      },
    },
  },
});

/**
 * Syncs our QueryClient instance into jotai-tanstack-query's queryClientAtom.
 * This ensures the XState machine's onRecognitionComplete action invalidates
 * the same cache that QueryClientProvider uses.
 */
function HydrateAtoms({ children }: { children: ReactNode }) {
  useHydrateAtoms([[queryClientAtom, queryClient]]);
  return children;
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  if (!isBooxDevice) {
    return <UnsupportedDeviceScreen />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <HydrateAtoms>
          <SafeAreaProvider>
            <SafeAreaListener onChange={({ insets }) => Uniwind.updateInsets(insets)}>
              <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="canvas" options={{ gestureEnabled: false }} />
                <Stack.Screen name="folder-picker" />
                <Stack.Screen name="settings" />
                <Stack.Screen name="trash" />
              </Stack>
              <StatusBar style="light" />
            </SafeAreaListener>
          </SafeAreaProvider>
        </HydrateAtoms>
      </JotaiProvider>
    </QueryClientProvider>
  );
}
