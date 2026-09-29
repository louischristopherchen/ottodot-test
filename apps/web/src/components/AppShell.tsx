import { Suspense } from 'react';
import { Outlet } from 'react-router';

import { PageLoader } from './PageLoader';
import { TopBar } from './TopBar';

export function AppShell() {
	return (
		<div className="flex min-h-screen flex-col">
			<a
				href="#main"
				className="sr-only rounded-md bg-card px-4 py-2 font-medium shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:outline-none focus:ring-2 focus:ring-ring"
			>
				Skip to main content
			</a>
			<TopBar />
			<main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 focus:outline-none sm:py-8">
				<Suspense fallback={<PageLoader />}>
					<Outlet />
				</Suspense>
			</main>
		</div>
	);
}
