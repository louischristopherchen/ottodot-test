import { Navigate } from 'react-router';

import { useSession } from '@/hooks/useSession';
import { homePathFor } from '@/lib/routes';

import { PageLoader } from './PageLoader';

export function HomeRedirect() {
	const status = useSession((state) => state.status);
	const user = useSession((state) => state.user);

	if (status === 'unknown') {
		return <PageLoader />;
	}
	return <Navigate to={user ? homePathFor(user.role) : '/login'} replace />;
}
