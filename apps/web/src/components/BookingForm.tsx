import { useEffect, useState, type FormEvent, type Ref } from 'react';
import type { BookingDto } from '@trial-booking/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner, toast } from '@trial-booking/ui';

import { useCreateBooking } from '@/hooks/useCreateBooking';
import { useStudents } from '@/hooks/useStudents';
import { useTrialClasses } from '@/hooks/useTrialClasses';
import { isClassBookable } from '@/lib/booking';
import { formatMoney, formatSgtDateTime, levelLabel } from '@/lib/format';

import { ErrorAlert } from './ErrorAlert';
import { PageLoader } from './PageLoader';
import { RadioRow } from './RadioRow';
import { SeatsBadge } from './SeatsBadge';
import { SubjectLabel } from './SubjectLabel';

interface BookingFormProps {
	/** True while a payment runs: every input on the page is locked. */
	disabled: boolean;
	onBooked: (booking: BookingDto) => void;
	headingRef?: Ref<HTMLHeadingElement>;
}

export function BookingForm({ disabled, onBooked, headingRef }: BookingFormProps) {
	const students = useStudents();
	const classes = useTrialClasses();
	const createBooking = useCreateBooking();
	const [chosenStudentId, setChosenStudentId] = useState<string | null>(null);
	const [classId, setClassId] = useState<string | null>(null);

	const studentList = students.data ?? [];
	const classList = classes.data ?? [];
	const studentId = chosenStudentId ?? (studentList.length === 1 ? studentList[0].id : null);

	// Another parent may take the last seat while this one is still choosing.
	useEffect(() => {
		if (!classId || !classes.data) {
			return;
		}
		const selected = classes.data.find((item) => item.id === classId);
		if (selected && isClassBookable(selected)) {
			return;
		}
		setClassId(null);
		toast({
			title: selected ? `${selected.title} is now full` : 'That class is no longer open for booking',
			description: 'Choose another class.',
		});
	}, [classes.data, classId]);

	const busy = disabled || createBooking.isPending;
	const canContinue = Boolean(studentId && classId) && !busy;

	function chooseStudent(id: string) {
		setChosenStudentId(id);
		createBooking.reset();
	}

	function chooseClass(id: string) {
		setClassId(id);
		createBooking.reset();
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!studentId || !classId || busy) {
			return;
		}
		createBooking.mutate(
			{ studentId, trialClassId: classId },
			{
				onSuccess: (result) => {
					setClassId(null);
					onBooked(result.booking);
				},
			},
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle as="h1" ref={headingRef} tabIndex={-1} className="focus:outline-none">
					Book a trial class
				</CardTitle>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleSubmit} className="space-y-6" noValidate>
					<fieldset disabled={busy} className="min-w-0">
						<legend className="text-sm font-semibold">1. Child</legend>
						<div className="mt-3">
							{students.isPending ? (
								<PageLoader label="Loading children" />
							) : students.isError ? (
								<ErrorAlert error={students.error} />
							) : studentList.length === 0 ? (
								<p className="text-sm text-muted-foreground">No children are linked to this account.</p>
							) : (
								<div className="grid gap-2 sm:grid-cols-2">
									{studentList.map((student) => (
										<RadioRow
											key={student.id}
											id={`student-${student.id}`}
											name="student"
											value={student.id}
											checked={studentId === student.id}
											onSelect={chooseStudent}
											label={student.name}
											aside={<Badge variant="outline">{levelLabel(student.level)}</Badge>}
										/>
									))}
								</div>
							)}
						</div>
					</fieldset>

					<fieldset disabled={busy} className="min-w-0">
						<legend className="text-sm font-semibold">2. Trial class</legend>
						<div className="mt-3">
							{classes.isPending ? (
								<PageLoader label="Loading classes" />
							) : classes.isError && classList.length === 0 ? (
								<ErrorAlert error={classes.error} />
							) : classList.length === 0 ? (
								<p className="text-sm text-muted-foreground">No upcoming trial classes.</p>
							) : (
								<div className="grid gap-2">
									{classList.map((trialClass) => (
										<RadioRow
											key={trialClass.id}
											id={`class-${trialClass.id}`}
											name="trialClass"
											value={trialClass.id}
											checked={classId === trialClass.id}
											disabled={!isClassBookable(trialClass)}
											onSelect={chooseClass}
											eyebrow={<SubjectLabel subject={trialClass.subject} />}
											label={trialClass.title}
											description={`${formatSgtDateTime(trialClass.startsAt)} · ${trialClass.teacherName} · ${formatMoney(trialClass.priceCents, trialClass.currency)}`}
											aside={<SeatsBadge seatsLeft={trialClass.seatsLeft} capacity={trialClass.capacity} />}
										/>
									))}
								</div>
							)}
						</div>
					</fieldset>

					<div className="space-y-3">
						<Button type="submit" disabled={!canContinue} className="w-full sm:w-auto">
							{createBooking.isPending ? <Spinner /> : null}
							Continue to payment
						</Button>
						{createBooking.isError ? <ErrorAlert error={createBooking.error} /> : null}
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
