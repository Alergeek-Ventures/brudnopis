import '../global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Provider as JotaiProvider } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';
import { queryClientAtom } from 'jotai-tanstack-query';
import type { ReactNode } from 'react';
import { SafeAreaListener, SafeAreaProvider } from 'react-native-safe-area-context';
import { Uniwind } from 'uniwind';

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
  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <HydrateAtoms>
          <SafeAreaProvider>
            <SafeAreaListener onChange={({ insets }) => Uniwind.updateInsets(insets)}>
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                  name="canvas"
                  options={{
                    headerShown: false,
                    gestureEnabled: false,
                  }}
                />
                <Stack.Screen name="folder-picker" options={{ headerShown: false }} />
                <Stack.Screen name="settings" options={{ headerShown: false }} />
              </Stack>
              <StatusBar style="light" />
            </SafeAreaListener>
          </SafeAreaProvider>
        </HydrateAtoms>
      </JotaiProvider>
    </QueryClientProvider>
  );
}
