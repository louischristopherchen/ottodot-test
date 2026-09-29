import { QueryClient } from '@tanstack/react-query';

import { sessionStore } from '../stores/session';
import { isApiError } from './api';

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// A 4xx will not change on retry; only network and server failures are worth another go.
			retry: (failureCount, error) =>
				!(isApiError(error) && error.status >= 400 && error.status < 500) && failureCount < 2,
			staleTime: 1_000,
		},
		mutations: {
			retry: false,
		},
	},
});

// The next person to sign in on this tab must not see the previous person's cached data.
sessionStore.subscribe((state, previous) => {
	if (previous.user && state.user?.id !== previous.user.id) {
		queryClient.removeQueries();
	}
});
