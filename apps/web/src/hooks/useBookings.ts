import { useQuery } from '@tanstack/react-query';

import { api } from '@/services/api';
import { LIVE_REFETCH_MS, queryKeys } from '@/services/keys';

export function useBookings() {
	return useQuery({
		queryKey: queryKeys.bookings,
		queryFn: ({ signal }) => api.listBookings(signal),
		refetchInterval: LIVE_REFETCH_MS,
	});
}
