import { useRef } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { loginSchema, type LoginInput } from '@trial-booking/shared';
import {
	Alert,
	AlertDescription,
	Badge,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Input,
	Label,
	Spinner,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@trial-booking/ui';
import { Info } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation } from 'react-router';

import { ErrorAlert } from '@/components/ErrorAlert';
import { PageLoader } from '@/components/PageLoader';
import { useSession } from '@/hooks/useSession';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, SHOW_DEMO_ACCOUNTS, type DemoAccount } from '@/lib/demo-accounts';
import { roleLabel } from '@/lib/format';
import { pathAfterSignIn } from '@/lib/routes';
import { api, isApiError } from '@/services/api';

const FIELDS = ['email', 'password'] as const;

export function LoginPage() {
	const status = useSession((state) => state.status);
	const user = useSession((state) => state.user);
	const endReason = useSession((state) => state.endReason);
	const location = useLocation();
	const submitRef = useRef<HTMLButtonElement>(null);

	const form = useForm<LoginInput>({
		resolver: zodResolver(loginSchema),
		defaultValues: { email: '', password: '' },
	});
	const login = useMutation({ mutationFn: (values: LoginInput) => api.login(values) });

	if (status === 'unknown') {
		return <PageLoader />;
	}
	if (user) {
		const from = (location.state as { from?: string } | null)?.from;
		return <Navigate to={pathAfterSignIn(user.role, from)} replace />;
	}

	const { errors } = form.formState;

	const onSubmit = form.handleSubmit((values) => {
		login.mutate(values, {
			onError: (error) => {
				if (!isApiError(error)) {
					return;
				}
				for (const field of FIELDS) {
					const message = error.fieldError(field);
					if (message) {
						form.setError(field, { message });
					}
				}
			},
		});
	});

	function fillAccount(account: DemoAccount) {
		form.clearErrors();
		login.reset();
		form.setValue('email', account.email);
		form.setValue('password', DEMO_PASSWORD);
		submitRef.current?.focus();
	}

	return (
		<div className="mx-auto grid max-w-md gap-6 lg:max-w-none lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
			<Card>
				<CardHeader>
					<CardTitle as="h1">Sign in</CardTitle>
				</CardHeader>
				<CardContent>
					<form onSubmit={onSubmit} className="space-y-4" noValidate>
						{endReason === 'expired' ? (
							<Alert variant="warning">
								<Info aria-hidden="true" />
								<AlertDescription>Your session has ended. Sign in again.</AlertDescription>
							</Alert>
						) : null}
						<div className="space-y-2">
							<Label htmlFor="email">Email</Label>
							<Input
								id="email"
								type="email"
								autoComplete="username"
								inputMode="email"
								aria-invalid={errors.email ? true : undefined}
								aria-describedby={errors.email ? 'email-error' : undefined}
								disabled={login.isPending}
								{...form.register('email')}
							/>
							{errors.email ? (
								<p id="email-error" className="text-sm text-destructive">
									{errors.email.message}
								</p>
							) : null}
						</div>
						<div className="space-y-2">
							<Label htmlFor="password">Password</Label>
							<Input
								id="password"
								type="password"
								autoComplete="current-password"
								aria-invalid={errors.password ? true : undefined}
								aria-describedby={errors.password ? 'password-error' : undefined}
								disabled={login.isPending}
								{...form.register('password')}
							/>
							{errors.password ? (
								<p id="password-error" className="text-sm text-destructive">
									{errors.password.message}
								</p>
							) : null}
						</div>
						{login.isError ? <ErrorAlert error={login.error} /> : null}
						<Button ref={submitRef} type="submit" className="w-full" disabled={login.isPending}>
							{login.isPending ? <Spinner /> : null}
							Sign in
						</Button>
					</form>
				</CardContent>
			</Card>

			{SHOW_DEMO_ACCOUNTS ? (
				<Card className="bg-muted/40">
					<CardHeader>
						<CardTitle>Demo accounts</CardTitle>
						<CardDescription>
							Every demo account uses the password{' '}
							<code className="rounded bg-card px-1.5 py-0.5 font-mono text-foreground">{DEMO_PASSWORD}</code>.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead className="hidden sm:table-cell">Email</TableHead>
									<TableHead>Role</TableHead>
									<TableHead>
										<span className="sr-only">Action</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{DEMO_ACCOUNTS.map((account) => (
									<TableRow key={account.email}>
										<TableCell>
											<span className="block font-medium">{account.name}</span>
											<span className="block break-all text-muted-foreground sm:hidden">{account.email}</span>
											{account.children ? (
												<span className="block text-xs text-muted-foreground">{account.children}</span>
											) : null}
										</TableCell>
										<TableCell className="hidden sm:table-cell">{account.email}</TableCell>
										<TableCell>
											<Badge variant="secondary">{roleLabel(account.role)}</Badge>
										</TableCell>
										<TableCell className="text-right">
											<Button
												size="sm"
												variant="outline"
												disabled={login.isPending}
												onClick={() => fillAccount(account)}
											>
												Use
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			) : null}
		</div>
	);
}
