import { pathToFileURL } from 'node:url';

import { closeDatabase, sequelize } from '../config/database.js';
import { env } from '../config/env.js';
import { Booking, PaymentAttempt, Student, TrialClass, User } from '../models/index.js';
import { hashPassword } from '../modules/auth/passwords.js';

/**
 * Synthetic demo data. Class times are relative to the moment of seeding so the demo
 * works on any day. Every seeded account shares DEMO_PASSWORD.
 *
 *   npm run seed       seed an empty database
 *   npm run db:reset   wipe every table, then seed
 */

export const DEMO_PASSWORD = 'trial-demo-2026';
const PRICE_CENTS = 2000; // SGD 20.00 per trial

const PARENTS = {
	aisha: { name: 'Aisha Rahman', email: 'aisha.rahman@example.com' },
	ben: { name: 'Ben Carter', email: 'ben.carter@example.com' },
	chloe: { name: 'Chloe Tan', email: 'chloe.tan@example.com' },
	daniel: { name: 'Daniel Lim', email: 'daniel.lim@example.com' },
	elena: { name: 'Elena Petrova', email: 'elena.petrova@example.com' },
	farah: { name: 'Farah Hassan', email: 'farah.hassan@example.com' },
	george: { name: 'George Ng', email: 'george.ng@example.com' },
	hana: { name: 'Hana Sato', email: 'hana.sato@example.com' },
} as const;

export const STAFF_ACCOUNT = { name: 'Operations staff', email: 'staff@example.com' } as const;

const STUDENTS = {
	zara: { parent: 'aisha', name: 'Zara Rahman', level: 3 },
	idris: { parent: 'aisha', name: 'Idris Rahman', level: 5 },
	leo: { parent: 'ben', name: 'Leo Carter', level: 4 },
	ethan: { parent: 'chloe', name: 'Ethan Tan', level: 3 },
	mia: { parent: 'chloe', name: 'Mia Tan', level: 6 },
	noah: { parent: 'daniel', name: 'Noah Lim', level: 4 },
	sofia: { parent: 'elena', name: 'Sofia Petrova', level: 5 },
	adam: { parent: 'farah', name: 'Adam Hassan', level: 3 },
	lucas: { parent: 'george', name: 'Lucas Ng', level: 4 },
	yuki: { parent: 'hana', name: 'Yuki Sato', level: 5 },
} as const satisfies Record<string, { parent: keyof typeof PARENTS; name: string; level: number }>;

const CLASSES = {
	// 1 of 4 confirmed plus a declined payment. Leo's seat is the duplicate-booking case.
	float: { subject: 'science', title: 'Sink or float? Investigating buoyancy', teacher: 'Ms. Priya Nair', daysAhead: 1, sgtHour: 17 },
	// Exactly 3 of 4 confirmed: the last-seat race.
	fractions: { subject: 'math', title: 'Fractions with pizza', teacher: 'Mr. Marcus Wong', daysAhead: 2, sgtHour: 17 },
	// 4 of 4: full.
	magnets: { subject: 'science', title: 'Magnets: push and pull', teacher: 'Ms. Siti Aminah', daysAhead: 3, sgtHour: 10 },
	// Empty.
	patterns: { subject: 'math', title: 'Number patterns and puzzles', teacher: 'Mr. Kenji Ito', daysAhead: 4, sgtHour: 17 },
} as const;

const BOOKINGS: { student: keyof typeof STUDENTS; trialClass: keyof typeof CLASSES; status: 'confirmed' | 'payment_failed'; minutesAgo: number }[] = [
	{ student: 'leo', trialClass: 'float', status: 'confirmed', minutesAgo: 300 },
	{ student: 'sofia', trialClass: 'float', status: 'payment_failed', minutesAgo: 20 },
	{ student: 'noah', trialClass: 'fractions', status: 'confirmed', minutesAgo: 600 },
	{ student: 'lucas', trialClass: 'fractions', status: 'confirmed', minutesAgo: 480 },
	{ student: 'yuki', trialClass: 'fractions', status: 'confirmed', minutesAgo: 120 },
	{ student: 'idris', trialClass: 'magnets', status: 'confirmed', minutesAgo: 900 },
	{ student: 'mia', trialClass: 'magnets', status: 'confirmed', minutesAgo: 700 },
	{ student: 'adam', trialClass: 'magnets', status: 'confirmed', minutesAgo: 400 },
	{ student: 'sofia', trialClass: 'magnets', status: 'confirmed', minutesAgo: 200 },
];

export interface SeedIds {
	parents: Record<keyof typeof PARENTS, string>;
	staff: string;
	students: Record<keyof typeof STUDENTS, string>;
	classes: Record<keyof typeof CLASSES, string>;
}

/** Start time for a class `daysAhead` days after `now`, at `sgtHour`:00 Singapore time (UTC+8). */
export function classStart(now: Date, daysAhead: number, sgtHour: number): Date {
	const sgt = new Date(now.getTime() + 8 * 3_600_000);
	return new Date(Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate() + daysAhead, sgtHour - 8));
}

export async function resetDatabase(): Promise<void> {
	await sequelize.query(
		'TRUNCATE idempotency_keys, payment_jobs, payment_attempts, bookings, trial_classes, students, sessions, users RESTART IDENTITY CASCADE',
	);
}

export async function seedDemoData(now = new Date()): Promise<SeedIds> {
	// One hash for every account: they share the demo password.
	const passwordHash = await hashPassword(DEMO_PASSWORD);
	const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

	return sequelize.transaction(async (transaction) => {
		const parents = {} as SeedIds['parents'];
		for (const [key, parent] of Object.entries(PARENTS)) {
			const user = await User.create({ ...parent, role: 'parent', passwordHash }, { transaction });
			parents[key as keyof typeof PARENTS] = user.id;
		}
		const staff = await User.create({ ...STAFF_ACCOUNT, role: 'staff', passwordHash }, { transaction });

		const students = {} as SeedIds['students'];
		for (const [key, student] of Object.entries(STUDENTS)) {
			const created = await Student.create(
				{ parentId: parents[student.parent], name: student.name, level: student.level },
				{ transaction },
			);
			students[key as keyof typeof STUDENTS] = created.id;
		}

		const classes = {} as SeedIds['classes'];
		for (const [key, trialClass] of Object.entries(CLASSES)) {
			const created = await TrialClass.create(
				{
					subject: trialClass.subject,
					title: trialClass.title,
					teacherName: trialClass.teacher,
					startsAt: classStart(now, trialClass.daysAhead, trialClass.sgtHour),
					durationMinutes: 60,
					capacity: 4,
					priceCents: PRICE_CENTS,
					currency: 'SGD',
				},
				{ transaction },
			);
			classes[key as keyof typeof CLASSES] = created.id;
		}

		for (const [index, entry] of BOOKINGS.entries()) {
			const at = ago(entry.minutesAgo);
			const confirmed = entry.status === 'confirmed';
			// Confirmed rows go through the same trigger as live traffic, so confirmed_count is right.
			const booking = await Booking.create(
				{
					studentId: students[entry.student],
					trialClassId: classes[entry.trialClass],
					status: entry.status,
					confirmedAt: confirmed ? at : null,
					createdAt: at,
					updatedAt: at,
				},
				{ transaction, silent: true },
			);
			await PaymentAttempt.create(
				{
					bookingId: booking.id,
					amountCents: PRICE_CENTS,
					currency: 'SGD',
					paymentMethod: confirmed ? 'pm_card_visa' : 'pm_card_declined',
					status: confirmed ? 'captured' : 'declined',
					providerRef: confirmed ? `auth_seed_${index + 1}` : null,
					failureCode: confirmed ? null : 'insufficient_funds',
					createdAt: at,
					updatedAt: at,
				},
				{ transaction, silent: true },
			);
		}

		return { parents, staff: staff.id, students, classes };
	});
}

/**
 * Production and staging databases carry a marker in their Postgres comment (set by
 * .deploy/vps-setup.sh). The guard reads the target database itself, so it also holds
 * when the script runs from a laptop through an SSH tunnel with a development NODE_ENV.
 */
async function targetEnvironment(): Promise<string | null> {
	const [rows] = await sequelize.query(
		"SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = current_database()",
	);
	const comment = (rows as { comment: string | null }[])[0]?.comment ?? '';
	return /environment=(\w+)/.exec(comment)?.[1] ?? null;
}

async function main(): Promise<void> {
	const target = await targetEnvironment();
	const protectedTarget = ['production', 'staging'].includes(target ?? env.NODE_ENV);
	if (protectedTarget && process.env.ALLOW_DEMO_SEED !== 'true') {
		console.error(
			`Refusing to seed or reset a ${target ?? env.NODE_ENV} database with demo accounts that share a published password. ` +
				'Set ALLOW_DEMO_SEED=true only for a demo deployment.',
		);
		process.exitCode = 1;
		return;
	}
	const reset = process.argv.includes('--reset');
	if (reset) {
		await resetDatabase();
	} else if ((await User.count()) > 0) {
		console.log('Database already has data; nothing seeded. Use `npm run db:reset` to start over.');
		return;
	}
	await seedDemoData();
	console.log(`Demo data ${reset ? 'reset' : 'seeded'}. Every account uses the password "${DEMO_PASSWORD}".`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	try {
		await main();
	} finally {
		await closeDatabase();
	}
}
