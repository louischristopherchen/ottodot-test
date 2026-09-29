import type { BookingStatus, CancelReason } from '@trial-booking/shared';
import { Badge } from '@trial-booking/ui';

import { bookingStatusLabel } from '@/lib/format';

interface BookingStatusBadgeProps {
	status: BookingStatus;
	cancelReason: CancelReason | null;
}

export function BookingStatusBadge({ status, cancelReason }: BookingStatusBadgeProps) {
	const label = bookingStatusLabel(status, cancelReason);
	return <Badge variant={label.tone}>{label.text}</Badge>;
}
