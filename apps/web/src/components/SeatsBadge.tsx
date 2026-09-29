import { Badge } from '@trial-booking/ui';

import { seatsLabel } from '@/lib/format';

interface SeatsBadgeProps {
	seatsLeft: number;
	capacity: number;
	id?: string;
}

export function SeatsBadge({ seatsLeft, capacity, id }: SeatsBadgeProps) {
	const label = seatsLabel(seatsLeft, capacity);
	return (
		<Badge id={id} variant={label.tone}>
			{label.text}
		</Badge>
	);
}
