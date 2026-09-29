import { Alert, AlertDescription } from '@trial-booking/ui';
import { CircleAlert } from 'lucide-react';

import { errorMessage } from '@/services/api';

interface ErrorAlertProps {
	error: unknown;
	className?: string;
}

/** Shows the API's message as is. */
export function ErrorAlert({ error, className }: ErrorAlertProps) {
	return (
		<Alert variant="destructive" className={className}>
			<CircleAlert aria-hidden="true" />
			<AlertDescription>{errorMessage(error)}</AlertDescription>
		</Alert>
	);
}
