import type { NotOnRosterEntryDto, RosterEntryDto } from '@trial-booking/shared';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@trial-booking/ui';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { BookingStatusBadge } from '@/components/BookingStatusBadge';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PageLoader } from '@/components/PageLoader';
import { useRoster } from '@/hooks/useRoster';
import { formatSgtDateTime, levelLabel, paymentStatusText } from '@/lib/format';

export function RosterPage() {
	const { id = '' } = useParams();
	const roster = useRoster(id);

	return (
		<div className="space-y-4">
			<Link
				to="/staff"
				className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
			>
				<ArrowLeft aria-hidden="true" className="size-4" />
				All classes
			</Link>

			{roster.isPending ? (
				<PageLoader label="Loading roster" />
			) : !roster.data ? (
				<ErrorAlert error={roster.error} />
			) : (
				<Card>
					<CardHeader>
						<CardTitle as="h1">Roster: {roster.data.trialClass.title}</CardTitle>
						<CardDescription>
							{formatSgtDateTime(roster.data.trialClass.startsAt)} with {roster.data.trialClass.teacherName}.{' '}
							{roster.data.trialClass.confirmedCount} of {roster.data.trialClass.capacity} seats confirmed.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-8">
						<ConfirmedTable entries={roster.data.confirmed} />
						<section aria-labelledby="not-on-roster-heading" className="space-y-3">
							<h2 id="not-on-roster-heading" className="text-base font-semibold">
								Not on the roster
							</h2>
							<NotOnRosterTable entries={roster.data.notOnRoster} />
						</section>
					</CardContent>
				</Card>
			)}
		</div>
	);
}

function ConfirmedTable({ entries }: { entries: RosterEntryDto[] }) {
	if (entries.length === 0) {
		return <p className="text-sm text-muted-foreground">Nobody is confirmed yet.</p>;
	}
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="w-10">#</TableHead>
					<TableHead>Child</TableHead>
					<TableHead>Level</TableHead>
					<TableHead>Parent</TableHead>
					<TableHead>Email</TableHead>
					<TableHead>Confirmed at</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{entries.map((entry, index) => (
					<TableRow key={entry.bookingId}>
						<TableCell className="tabular-nums text-muted-foreground">{index + 1}</TableCell>
						<TableCell className="font-medium">{entry.studentName}</TableCell>
						<TableCell>{levelLabel(entry.level)}</TableCell>
						<TableCell>{entry.parentName}</TableCell>
						<TableCell className="break-all">{entry.parentEmail}</TableCell>
						<TableCell className="whitespace-nowrap">{formatSgtDateTime(entry.confirmedAt)}</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function NotOnRosterTable({ entries }: { entries: NotOnRosterEntryDto[] }) {
	if (entries.length === 0) {
		return <p className="text-sm text-muted-foreground">None.</p>;
	}
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Child</TableHead>
					<TableHead>Parent</TableHead>
					<TableHead>Booking</TableHead>
					<TableHead>Last payment</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{entries.map((entry) => (
					<TableRow key={entry.bookingId}>
						<TableCell className="font-medium">{entry.studentName}</TableCell>
						<TableCell>{entry.parentName}</TableCell>
						<TableCell>
							<BookingStatusBadge status={entry.status} cancelReason={entry.cancelReason} />
						</TableCell>
						<TableCell>{paymentStatusText(entry.lastPaymentStatus, entry.lastPaymentFailureCode)}</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
