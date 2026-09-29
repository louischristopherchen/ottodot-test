import { useQuery } from '@tanstack/react-query';

import { api } from '@/services/api';
import { LIVE_REFETCH_MS, queryKeys } from '@/services/keys';

export function useTrialClasses() {
	return useQuery({
		queryKey: queryKeys.trialClasses,
		queryFn: ({ signal }) => api.listTrialClasses(signal),
		refetchInterval: LIVE_REFETCH_MS,
	});
}
