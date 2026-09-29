import type { Role } from '@trial-booking/shared';

// Mirrors the API seed. Shown on the sign-in page only when SHOW_DEMO_ACCOUNTS is 'true'.

export const DEMO_PASSWORD = 'trial-demo-2026';

export interface DemoAccount {
	name: string;
	email: string;
	role: Role;
	/** Children as shown in the booking form, for parents. */
	children?: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
	{ name: 'Aisha Rahman', email: 'aisha.rahman@example.com', role: 'parent', children: 'Zara Rahman P3, Idris Rahman P5' },
	{ name: 'Ben Carter', email: 'ben.carter@example.com', role: 'parent', children: 'Leo Carter P4' },
	{ name: 'Chloe Tan', email: 'chloe.tan@example.com', role: 'parent', children: 'Ethan Tan P3, Mia Tan P6' },
	{ name: 'Farah Hassan', email: 'farah.hassan@example.com', role: 'parent', children: 'Adam Hassan P3' },
	{ name: 'Operations staff', email: 'staff@example.com', role: 'staff' },
];

/** Replaced at build time by the Rspack DefinePlugin. */
export const SHOW_DEMO_ACCOUNTS = process.env.SHOW_DEMO_ACCOUNTS === 'true';
