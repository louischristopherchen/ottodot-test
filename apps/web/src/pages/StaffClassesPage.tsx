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
import { Link } from 'react-router';

import { ErrorAlert } from '@/components/ErrorAlert';
import { PageLoader } from '@/components/PageLoader';
import { SubjectLabel } from '@/components/SubjectLabel';
import { useTrialClasses } from '@/hooks/useTrialClasses';
import { confirmedOfCapacity, formatSgtDateTime } from '@/lib/format';

export function StaffClassesPage() {
	const classes = useTrialClasses();

	return (
		<Card>
			<CardHeader>
				<CardTitle as="h1">Upcoming trial classes</CardTitle>
			</CardHeader>
			<CardContent>
				{classes.isPending ? (
					<PageLoader label="Loading classes" />
				) : !classes.data ? (
					<ErrorAlert error={classes.error} />
				) : classes.data.length === 0 ? (
					<p className="text-sm text-muted-foreground">No upcoming trial classes.</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Class</TableHead>
								<TableHead>Starts</TableHead>
								<TableHead>Teacher</TableHead>
								<TableHead>Confirmed</TableHead>
								<TableHead>
									<span className="sr-only">Roster</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{classes.data.map((trialClass) => (
								<TableRow key={trialClass.id}>
									<TableCell>
										<SubjectLabel subject={trialClass.subject} />
										<span className="font-medium">{trialClass.title}</span>
									</TableCell>
									<TableCell className="whitespace-nowrap">{formatSgtDateTime(trialClass.startsAt)}</TableCell>
									<TableCell>{trialClass.teacherName}</TableCell>
									<TableCell className="whitespace-nowrap tabular-nums">
										{confirmedOfCapacity(trialClass.confirmedCount, trialClass.capacity)}
									</TableCell>
									<TableCell className="text-right">
										<Button asChild size="sm" variant="outline">
											<Link to={`/staff/classes/${trialClass.id}`}>View roster</Link>
										</Button>
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
