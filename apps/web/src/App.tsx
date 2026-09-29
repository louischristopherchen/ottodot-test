import { lazy } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@trial-booking/ui';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';

import { AppShell } from '@/components/AppShell';
import { HomeRedirect } from '@/components/HomeRedirect';
import { RequireRole } from '@/components/RequireRole';
import { RouteError } from '@/components/RouteError';
import { queryClient } from '@/services/query-client';

const LoginPage = lazy(() =>
	import(/* webpackChunkName: "login" */ '@/pages/LoginPage').then((module) => ({ default: module.LoginPage })),
);
const BookPage = lazy(() =>
	import(/* webpackChunkName: "book" */ '@/pages/BookPage').then((module) => ({ default: module.BookPage })),
);
const StaffClassesPage = lazy(() =>
	import(/* webpackChunkName: "staff" */ '@/pages/StaffClassesPage').then((module) => ({
		default: module.StaffClassesPage,
	})),
);
const RosterPage = lazy(() =>
	import(/* webpackChunkName: "roster" */ '@/pages/RosterPage').then((module) => ({ default: module.RosterPage })),
);

const router = createBrowserRouter([
	{
		element: <AppShell />,
		errorElement: <RouteError />,
		children: [
			{ path: '/', element: <HomeRedirect /> },
			{ path: '/login', element: <LoginPage /> },
			{
				element: <RequireRole role="parent" />,
				children: [{ path: '/book', element: <BookPage /> }],
			},
			{
				element: <RequireRole role="staff" />,
				children: [
					{ path: '/staff', element: <StaffClassesPage /> },
					{ path: '/staff/classes/:id', element: <RosterPage /> },
				],
			},
			{ path: '*', element: <Navigate to="/" replace /> },
		],
	},
]);

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
			<Toaster />
		</QueryClientProvider>
	);
}
