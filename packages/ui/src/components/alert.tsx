import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils';

const alertVariants = cva(
	'relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg]:size-4 [&>svg~*]:pl-7',
	{
		variants: {
			variant: {
				default: 'border-border bg-card text-card-foreground [&>svg]:text-foreground',
				success: 'border-success/40 bg-success/10 text-foreground [&>svg]:text-success',
				warning: 'border-warning/60 bg-warning/15 text-foreground [&>svg]:text-warning-foreground',
				destructive: 'border-destructive/50 bg-destructive/10 text-destructive [&>svg]:text-destructive',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	},
);

export type AlertVariant = NonNullable<VariantProps<typeof alertVariants>['variant']>;

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

/** Destructive alerts interrupt screen readers (`role="alert"`); every other tone is polite (`role="status"`). */
const Alert = React.forwardRef<HTMLDivElement, AlertProps>(({ className, variant, role, ...props }, ref) => (
	<div
		ref={ref}
		role={role ?? (variant === 'destructive' ? 'alert' : 'status')}
		className={cn(alertVariants({ variant }), className)}
		{...props}
	/>
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
	({ className, ...props }, ref) => (
		<p ref={ref} className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />
	),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div ref={ref} className={cn('text-sm leading-relaxed [&_p]:leading-relaxed', className)} {...props} />
	),
);
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription, alertVariants };
