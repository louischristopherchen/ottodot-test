import type { BookingDto, TestCardId } from '@trial-booking/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { upsertBooking } from '@/lib/booking';
import { newIdempotencyKey } from '@/lib/idempotency';
import { api } from '@/services/api';
import { queryKeys } from '@/services/keys';

export interface PayBookingVariables {
	bookingId: string;
	paymentMethod: TestCardId;
}

export function usePayBooking() {
	const queryClient = useQueryClient();
	return useMutation({
		// A new key per click; the client reuses it only when it retries this same request after a token refresh.
		mutationFn: ({ bookingId, paymentMethod }: PayBookingVariables) =>
			api.payBooking(bookingId, { paymentMethod }, newIdempotencyKey()),
		onSuccess: (result) => {
			queryClient.setQueryData<BookingDto[]>(queryKeys.bookings, (list) => upsertBooking(list, result.booking));
		},
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
			void queryClient.invalidateQueries({ queryKey: queryKeys.trialClasses });
		},
	});
}
