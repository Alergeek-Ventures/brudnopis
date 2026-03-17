import '../global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
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

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <SafeAreaListener onChange={({ insets }) => Uniwind.updateInsets(insets)}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="canvas" options={{ headerShown: false }} />
            <Stack.Screen name="folder-picker" options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="light" />
        </SafeAreaListener>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
