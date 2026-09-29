import { useState, type FormEvent, type Ref } from 'react';
import type { BookingDto, PaymentResultDto, TestCardId } from '@trial-booking/shared';
import { TEST_CARD_IDS, TEST_CARDS } from '@trial-booking/shared/constants';
import {
	Alert,
	AlertDescription,
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	Spinner,
} from '@trial-booking/ui';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';

import { isPayable } from '@/lib/booking';
import { formatMoney, formatSgtDateTime, paymentOutcomeTone } from '@/lib/format';

import { BookingStatusBadge } from './BookingStatusBadge';
import { ErrorAlert } from './ErrorAlert';
import { RadioRow } from './RadioRow';

interface PaymentCardProps {
	booking: BookingDto;
	/** Result of the last Pay click for this booking, if any. */
	result: PaymentResultDto | null;
	error: unknown;
	isPaying: boolean;
	onPay: (paymentMethod: TestCardId) => void;
	onBookAnother: () => void;
	headingRef?: Ref<HTMLHeadingElement>;
}

const OUTCOME_ICONS = {
	success: CircleCheck,
	destructive: CircleAlert,
	default: Info,
} as const;

export function PaymentCard({ booking, result, error, isPaying, onPay, onBookAnother, headingRef }: PaymentCardProps) {
	const [paymentMethod, setPaymentMethod] = useState<TestCardId>(TEST_CARD_IDS[0]);
	const amount = formatMoney(booking.trialClass.priceCents, booking.trialClass.currency);
	const payable = isPayable(booking.status);

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!isPaying) {
			onPay(paymentMethod);
		}
	}

	const tone = result ? paymentOutcomeTone(result.outcome) : 'default';
	const OutcomeIcon = OUTCOME_ICONS[tone];

	return (
		<Card>
			<CardHeader>
				<CardTitle ref={headingRef} tabIndex={-1} className="focus:outline-none">
					Payment
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-6">
				<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
					<dt className="text-muted-foreground">Child</dt>
					<dd className="font-medium">{booking.student.name}</dd>
					<dt className="text-muted-foreground">Class</dt>
					<dd className="font-medium">{booking.trialClass.title}</dd>
					<dt className="text-muted-foreground">Starts</dt>
					<dd>{formatSgtDateTime(booking.trialClass.startsAt)}</dd>
					<dt className="text-muted-foreground">Amount</dt>
					<dd>{amount}</dd>
					<dt className="text-muted-foreground">Status</dt>
					<dd>
						<BookingStatusBadge status={booking.status} cancelReason={booking.cancelReason} />
					</dd>
				</dl>

				{result && !isPaying ? (
					<Alert variant={tone}>
						<OutcomeIcon aria-hidden="true" />
						<AlertDescription>{result.message}</AlertDescription>
					</Alert>
				) : null}
				{error && !isPaying ? <ErrorAlert error={error} /> : null}

				{payable ? (
					<form onSubmit={handleSubmit} className="space-y-4" noValidate>
						<fieldset disabled={isPaying} className="min-w-0">
							<legend className="text-sm font-semibold">Test card</legend>
							<div className="mt-3 grid gap-2">
								{TEST_CARD_IDS.map((cardId) => (
									<RadioRow
										key={cardId}
										id={`card-${cardId}`}
										name="paymentMethod"
										value={cardId}
										checked={paymentMethod === cardId}
										onSelect={(value) => setPaymentMethod(value as TestCardId)}
										label={TEST_CARDS[cardId].label}
										description={TEST_CARDS[cardId].description}
									/>
								))}
							</div>
						</fieldset>
						<Button type="submit" disabled={isPaying} className="w-full sm:w-auto">
							{isPaying ? (
								<>
									<Spinner />
									Processing payment...
								</>
							) : (
								`Pay ${amount}`
							)}
						</Button>
					</form>
				) : (
					<Button variant="secondary" onClick={onBookAnother}>
						Book another class
					</Button>
				)}
			</CardContent>
		</Card>
	);
}
