import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query defaults tuned for a mobile app with no backend of its own.
 *
 * The key constraints here are memory (results are large arrays) and battery
 * (background refetches while the screen is off are pure waste), so caches are
 * short-lived and retries are deliberately shallow.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Provider responses are near-static catalogue data; 5 minutes avoids a
        // refetch storm while typing without serving visibly stale lists.
        staleTime: 5 * 60 * 1000,
        // Drop pages fairly aggressively: a long-lived list of search results is
        // the biggest JS heap consumer in this app.
        gcTime: 10 * 60 * 1000,
        retry: 1,
        // Returning stale data while a refresh runs keeps list transitions
        // from flashing empty states on every navigation.
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

/** Shared instance used by the app-level `QueryClientProvider`. */
export const queryClient = createQueryClient();