import type { Subject } from '@trial-booking/shared';
import { cn } from '@trial-booking/ui';

import { subjectLabel } from '@/lib/format';

interface SubjectLabelProps {
	subject: Subject;
	id?: string;
	className?: string;
}

export function SubjectLabel({ subject, id, className }: SubjectLabelProps) {
	return (
		<span
			id={id}
			className={cn('block text-sm font-semibold tracking-wide text-muted-foreground [font-variant-caps:all-small-caps]', className)}
		>
			{subjectLabel(subject)}
		</span>
	);
}
