import type { BookingDto } from '@trial-booking/shared';
import {
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@trial-booking/ui';

import { bookingPaymentText, isPayable } from '@/lib/booking';
import { formatSgtDateTime } from '@/lib/format';

import { BookingStatusBadge } from './BookingStatusBadge';
import { ErrorAlert } from './ErrorAlert';
import { PageLoader } from './PageLoader';

interface BookingsCardProps {
	bookings: BookingDto[] | undefined;
	isPending: boolean;
	error: unknown;
	disabled: boolean;
	onPay: (booking: BookingDto) => void;
}

export function BookingsCard({ bookings, isPending, error, disabled, onPay }: BookingsCardProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Your bookings</CardTitle>
			</CardHeader>
			<CardContent>
				{isPending ? (
					<PageLoader label="Loading bookings" />
				) : !bookings ? (
					<ErrorAlert error={error} />
				) : bookings.length === 0 ? (
					<p className="text-sm text-muted-foreground">No bookings yet.</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Child</TableHead>
								<TableHead>Class</TableHead>
								<TableHead>Starts</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Payment</TableHead>
								<TableHead>
									<span className="sr-only">Action</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{bookings.map((booking) => (
								<TableRow key={booking.id}>
									<TableCell className="font-medium">{booking.student.name}</TableCell>
									<TableCell>{booking.trialClass.title}</TableCell>
									<TableCell className="whitespace-nowrap">
										{formatSgtDateTime(booking.trialClass.startsAt)}
									</TableCell>
									<TableCell>
										<BookingStatusBadge status={booking.status} cancelReason={booking.cancelReason} />
									</TableCell>
									<TableCell>{bookingPaymentText(booking)}</TableCell>
									<TableCell className="text-right">
										{isPayable(booking.status) ? (
											<Button size="sm" variant="outline" disabled={disabled} onClick={() => onPay(booking)}>
												{booking.status === 'payment_failed' ? 'Retry payment' : 'Pay'}
											</Button>
										) : null}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
