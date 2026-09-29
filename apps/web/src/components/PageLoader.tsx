import { Spinner } from '@trial-booking/ui';

interface PageLoaderProps {
	label?: string;
}

export function PageLoader({ label = 'Loading' }: PageLoaderProps) {
	return (
		<div role="status" className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
			<Spinner />
			<span>{label}</span>
		</div>
	);
}
