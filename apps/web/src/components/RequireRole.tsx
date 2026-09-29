import type { Role } from '@trial-booking/shared';
import { Navigate, Outlet, useLocation } from 'react-router';

import { useSession } from '@/hooks/useSession';
import { homePathFor } from '@/lib/routes';

import { PageLoader } from './PageLoader';

interface RequireRoleProps {
	role: Role;
}

/** Signed-out visitors go to /login; a parent opening a staff page lands on /book, and the other way round. */
export function RequireRole({ role }: RequireRoleProps) {
	const status = useSession((state) => state.status);
	const user = useSession((state) => state.user);
	const location = useLocation();

	if (status === 'unknown') {
		return <PageLoader />;
	}
	if (!user) {
		return <Navigate to="/login" replace state={{ from: location.pathname }} />;
	}
	if (user.role !== role) {
		return <Navigate to={homePathFor(user.role)} replace />;
	}
	return <Outlet />;
}
