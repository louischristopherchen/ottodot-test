import type { BookingDto, CreateBookingInput } from '@trial-booking/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { upsertBooking } from '@/lib/booking';
import { api } from '@/services/api';
import { queryKeys } from '@/services/keys';

export function useCreateBooking() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateBookingInput) => api.createBooking(input),
		onSuccess: (result) => {
			queryClient.setQueryData<BookingDto[]>(queryKeys.bookings, (list) => upsertBooking(list, result.booking));
			void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
		},
		onSettled: () => {
			// A CLASS_FULL or BOOKING_CLOSED answer means the seat badges are stale.
			void queryClient.invalidateQueries({ queryKey: queryKeys.trialClasses });
		},
	});
}
