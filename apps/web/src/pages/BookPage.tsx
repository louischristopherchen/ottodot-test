import { useEffect, useRef, useState } from 'react';
import type { BookingDto, PaymentResultDto, TestCardId } from '@trial-booking/shared';

import { BookingForm } from '@/components/BookingForm';
import { BookingsCard } from '@/components/BookingsCard';
import { PaymentCard } from '@/components/PaymentCard';
import { useBookings } from '@/hooks/useBookings';
import { usePayBooking } from '@/hooks/usePayBooking';
import { newerBooking } from '@/lib/booking';

export function BookPage() {
	const bookings = useBookings();
	const payBooking = usePayBooking();
	const [activeSnapshot, setActiveSnapshot] = useState<BookingDto | null>(null);
	const [result, setResult] = useState<PaymentResultDto | null>(null);
	const bookHeadingRef = useRef<HTMLHeadingElement>(null);
	const paymentHeadingRef = useRef<HTMLHeadingElement>(null);

	const activeId = activeSnapshot?.id ?? null;
	const activeBooking = activeSnapshot
		? newerBooking(
				bookings.data?.find((item) => item.id === activeSnapshot.id),
				activeSnapshot,
			)
		: null;
	const isPaying = payBooking.isPending;

	// Keyboard and screen reader users land on the payment step as soon as it appears.
	useEffect(() => {
		if (activeId) {
			paymentHeadingRef.current?.focus();
		}
	}, [activeId]);

	function openPayment(booking: BookingDto) {
		setActiveSnapshot(booking);
		setResult(null);
		payBooking.reset();
	}

	function pay(paymentMethod: TestCardId) {
		if (!activeBooking) {
			return;
		}
		setResult(null);
		payBooking.mutate(
			{ bookingId: activeBooking.id, paymentMethod },
			{
				onSuccess: (paymentResult) => {
					setResult(paymentResult);
					setActiveSnapshot(paymentResult.booking);
				},
			},
		);
	}

	function bookAnother() {
		bookHeadingRef.current?.focus();
		setActiveSnapshot(null);
		setResult(null);
		payBooking.reset();
	}

	return (
		<div className="space-y-6">
			<BookingForm disabled={isPaying} onBooked={openPayment} headingRef={bookHeadingRef} />
			{activeBooking ? (
				<PaymentCard
					key={activeBooking.id}
					booking={activeBooking}
					result={result && result.booking.id === activeBooking.id ? result : null}
					error={payBooking.error}
					isPaying={isPaying}
					onPay={pay}
					onBookAnother={bookAnother}
					headingRef={paymentHeadingRef}
				/>
			) : null}
			<BookingsCard
				bookings={bookings.data}
				isPending={bookings.isPending}
				error={bookings.error}
				disabled={isPaying}
				onPay={openPayment}
			/>
		</div>
	);
}
