import type { ReactNode } from 'react';
import { cn } from '@trial-booking/ui';

interface RadioRowProps {
	id: string;
	name: string;
	value: string;
	checked: boolean;
	disabled?: boolean;
	onSelect: (value: string) => void;
	/** The radio's accessible name. Keep it short: the title or the child's name. */
	label: ReactNode;
	/** Small line above the label, such as the subject. */
	eyebrow?: ReactNode;
	description?: ReactNode;
	/** Right-aligned content, such as a badge. */
	aside?: ReactNode;
}

/**
 * One selectable row. The `<label>` stretches over the whole row, so a click anywhere
 * selects the radio, while the extra lines are announced as its description.
 */
export function RadioRow({
	id,
	name,
	value,
	checked,
	disabled = false,
	onSelect,
	label,
	eyebrow,
	description,
	aside,
}: RadioRowProps) {
	const describedBy = [eyebrow && `${id}-eyebrow`, description && `${id}-description`, aside && `${id}-aside`]
		.filter(Boolean)
		.join(' ');

	return (
		<div
			className={cn(
				'relative flex min-h-11 items-start gap-3 rounded-lg border bg-card p-3 transition-colors sm:p-4',
				'has-[:checked]:border-primary has-[:checked]:bg-primary/5',
				'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
				disabled ? 'bg-muted/60 text-muted-foreground' : 'hover:bg-muted/50',
			)}
		>
			<input
				id={id}
				type="radio"
				name={name}
				value={value}
				checked={checked}
				disabled={disabled}
				onChange={() => onSelect(value)}
				aria-describedby={describedBy || undefined}
				className="relative z-10 mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-none disabled:cursor-not-allowed"
			/>
			<div className="min-w-0 flex-1 space-y-0.5">
				{eyebrow ? (
					<div id={`${id}-eyebrow`} className="leading-tight">
						{eyebrow}
					</div>
				) : null}
				<label
					htmlFor={id}
					className={cn(
						'block font-medium leading-snug after:absolute after:inset-0 after:rounded-lg',
						disabled ? 'cursor-not-allowed' : 'cursor-pointer',
					)}
				>
					{label}
				</label>
				{description ? (
					<div id={`${id}-description`} className="text-sm text-muted-foreground">
						{description}
					</div>
				) : null}
			</div>
			{aside ? (
				<div id={`${id}-aside`} className="shrink-0">
					{aside}
				</div>
			) : null}
		</div>
	);
}
