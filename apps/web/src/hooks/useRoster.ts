import { useQuery } from '@tanstack/react-query';

import { api } from '@/services/api';
import { LIVE_REFETCH_MS, queryKeys } from '@/services/keys';

export function useRoster(trialClassId: string) {
	return useQuery({
		queryKey: queryKeys.roster(trialClassId),
		queryFn: ({ signal }) => api.getRoster(trialClassId, signal),
		// Stop polling an id the API rejected (unknown class, malformed id).
		refetchInterval: (query) => (query.state.status === 'error' ? false : LIVE_REFETCH_MS),
		enabled: trialClassId.length > 0,
	});
}
