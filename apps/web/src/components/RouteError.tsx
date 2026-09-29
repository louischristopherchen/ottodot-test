import { Alert, AlertDescription, AlertTitle, Button } from '@trial-booking/ui';
import { CircleAlert } from 'lucide-react';

/** Last resort when a page throws while rendering. */
export function RouteError() {
	return (
		<div className="mx-auto max-w-lg px-4 py-16">
			<Alert variant="destructive">
				<CircleAlert aria-hidden="true" />
				<div>
					<AlertTitle>Something went wrong</AlertTitle>
					<AlertDescription>The page could not be shown. Reload to try again.</AlertDescription>
					<Button className="mt-3" variant="outline" size="sm" onClick={() => window.location.reload()}>
						Reload
					</Button>
				</div>
			</Alert>
		</div>
	);
}
