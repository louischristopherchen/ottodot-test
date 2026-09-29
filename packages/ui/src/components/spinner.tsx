import * as React from 'react';
import { LoaderCircle } from 'lucide-react';

import { cn } from '../lib/utils';

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
	/** When set, the spinner is announced as a status with this text; otherwise it is decorative. */
	label?: string;
}

function Spinner({ className, label, ...props }: SpinnerProps) {
	const icon = <LoaderCircle aria-hidden="true" className={cn('size-4 animate-spin', className)} {...props} />;
	if (!label) {
		return icon;
	}
	return (
		<span role="status" className="inline-flex items-center">
			{icon}
			<span className="sr-only">{label}</span>
		</span>
	);
}

export { Spinner };
