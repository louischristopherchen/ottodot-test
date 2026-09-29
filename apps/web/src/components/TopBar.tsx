import { Badge, Button, Spinner } from '@trial-booking/ui';
import { GraduationCap, LogOut } from 'lucide-react';
import { Link } from 'react-router';

import { useSession } from '@/hooks/useSession';
import { useSignOut } from '@/hooks/useSignOut';
import { roleLabel } from '@/lib/format';

export function TopBar() {
	const user = useSession((state) => state.user);
	const signOut = useSignOut();

	return (
		<header className="border-b bg-card">
			<div className="mx-auto flex min-h-16 w-full max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
				<Link
					to="/"
					className="flex shrink-0 items-center gap-2 rounded-md font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				>
					<GraduationCap aria-hidden="true" className="size-5 text-primary" />
					Trial booking
				</Link>
				{user ? (
					<div className="flex min-w-0 items-center gap-2 sm:gap-3">
						<span className="min-w-0 truncate text-sm font-medium sm:max-w-64">{user.name}</span>
						<Badge variant="secondary">{roleLabel(user.role)}</Badge>
						<Button
							variant="outline"
							size="sm"
							onClick={() => signOut.mutate()}
							disabled={signOut.isPending}
						>
							{signOut.isPending ? <Spinner /> : <LogOut aria-hidden="true" />}
							Sign out
						</Button>
					</div>
				) : null}
			</div>
		</header>
	);
}
