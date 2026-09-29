// Narrated walkthrough of the last-seat race: `npm run demo:race`.
// Runs against throwaway databases, so the demo data used by the app is untouched.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { styleText } from 'node:util';
import { openDatabase } from '../db/database.ts';
import { SEED, seedDemoData } from '../db/seed.ts';
import { execute, queryAll } from '../db/sql.ts';
import { createBooking, payForBooking, type PaymentResult } from '../domain/bookings.ts';
import { getRoster } from '../domain/queries.ts';
import type { Deps } from '../domain/types.ts';
import { MockPaymentProvider } from '../payments/mock-provider.ts';
import { runPaymentsInParallelProcesses } from './pay-worker.ts';

const { parents, students, classes } = SEED;
const workDir = mkdtempSync(join(tmpdir(), 'trial-booking-race-demo-'));

function freshDeps(name: string): Deps & { dbPath: string } {
  const dbPath = join(workDir, `${name}.db`);
  const db = openDatabase(dbPath);
  seedDemoData(db, new Date());
  const payments = new MockPaymentProvider({ latencyMs: 300, slowLatencyMs: 1500 });
  return { db, dbPath, payments, now: () => new Date() };
}

const bold = (text: string) => styleText('bold', text);
const outcomeColor = (outcome: string) =>
  styleText(outcome === 'confirmed' ? 'green' : outcome === 'payment_declined' ? 'yellow' : 'red', outcome);

let t0 = Date.now();
const log = (message: string) =>
  console.log(`  ${styleText('dim', `+${((Date.now() - t0) / 1000).toFixed(2)}s`)}  ${message}`);

function describePayment(who: string, result: PaymentResult): string {
  const attempt = result.paymentAttempt ? `payment attempt ${result.paymentAttempt.status}` : 'no payment attempt made';
  return `${who}'s payment -> ${outcomeColor(result.outcome)} (${attempt}, booking ${result.booking.status})`;
}

async function scenarioFromTheBrief(): Promise<void> {
  const deps = freshDeps('scenario');
  console.log(bold('\n1. The scenario from the brief'));
  console.log(`   "Fractions with pizza" starts with 3 of 4 seats confirmed. The mock card provider takes`);
  console.log(`   0.3 s to authorize a normal card and 1.5 s for the slow test card.\n`);
  t0 = Date.now();

  const farah = createBooking(deps, parents.farah, { studentId: students.adam, trialClassId: classes.fractions }).booking;
  log(`Farah books the class for Adam but does not pay yet -> ${farah.status}`);

  const aisha = createBooking(deps, parents.aisha, { studentId: students.zara, trialClassId: classes.fractions }).booking;
  log(`User A (Aisha, for Zara) picks the last seat -> ${aisha.status}`);
  const aishaPayment = payForBooking(deps, parents.aisha, aisha.id, 'pm_card_visa_slow');
  log('User A moves to payment with the slow card; her authorization is in flight');

  await sleep(200);
  const chloe = createBooking(deps, parents.chloe, { studentId: students.ethan, trialClassId: classes.fractions }).booking;
  log(`User B (Chloe, for Ethan) picks the same seat -> ${chloe.status} (unpaid bookings hold no seat)`);
  const chloeResult = await payForBooking(deps, parents.chloe, chloe.id, 'pm_card_visa');
  log(describePayment('User B', chloeResult));

  const aishaResult = await aishaPayment;
  log(describePayment('User A', aishaResult));
  log(styleText('dim', `"${aishaResult.message}"`));

  const farahResult = await payForBooking(deps, parents.farah, farah.id, 'pm_card_visa');
  log(`Farah finally pays -> ${outcomeColor(farahResult.outcome)}, refused before her card was touched`);

  const roster = getRoster(deps.db, classes.fractions);
  console.log(
    `\n   Roster (${roster.confirmed.length} of ${roster.trialClass.capacity}): ${roster.confirmed.map((e) => e.studentName).join(', ')}`,
  );
  const money = queryAll<{ name: string; status: string }>(
    deps.db,
    `SELECT s.name, pa.status FROM payment_attempts pa
       JOIN bookings b ON b.id = pa.booking_id JOIN students s ON s.id = b.student_id
      WHERE pa.booking_id IN (:a, :b, :c) ORDER BY pa.created_at`,
    { a: aisha.id, b: chloe.id, c: farah.id },
  );
  console.log(`   Money: ${money.map((m) => `${m.name} ${m.status}`).join(', ') || 'none'}; Adam (Farah) never reached the provider`);
  deps.db.close();
}

async function crowdAcrossProcesses(): Promise<void> {
  const deps = freshDeps('crowd');
  const crowd = 10;
  console.log(bold(`\n2. ${crowd} parents in ${crowd} separate OS processes pay for the last seat at the same moment`));
  console.log('   Each process has its own database connection, like separate server instances.\n');

  const jobs = Array.from({ length: crowd }, (_, index) => {
    const parentId = `par_crowd_${index}`;
    const studentId = `stu_crowd_${index}`;
    execute(deps.db, `INSERT INTO parents (id, name, email) VALUES (:parentId, :name, :email)`, {
      parentId,
      name: `Crowd parent ${index + 1}`,
      email: `crowd${index + 1}@example.com`,
    });
    execute(deps.db, `INSERT INTO students (id, parent_id, name, level) VALUES (:studentId, :parentId, :name, 4)`, {
      studentId,
      parentId,
      name: `Crowd child ${index + 1}`,
    });
    return { parentId, bookingId: createBooking(deps, parentId, { studentId, trialClassId: classes.fractions }).booking.id };
  });

  const results = await runPaymentsInParallelProcesses(deps.dbPath, jobs);
  for (const result of results) {
    console.log(`   pid ${result.pid}  ${outcomeColor(result.outcome)}  payment attempt ${result.attemptStatus ?? 'none'}`);
  }
  const confirmed = results.filter((result) => result.outcome === 'confirmed').length;
  const roster = getRoster(deps.db, classes.fractions);
  console.log(
    `\n   ${confirmed} confirmed, ${results.length - confirmed} refused; roster ${roster.confirmed.length} of ${roster.trialClass.capacity}`,
  );
  deps.db.close();
}

function databaseBackstops(): void {
  const deps = freshDeps('backstop');
  console.log(bold('\n3. Database backstops: raw SQL that bypasses the application code'));
  const now = new Date().toISOString();
  const insert = (id: string, studentId: string, trialClassId: string, status: string) =>
    execute(
      deps.db,
      `INSERT INTO bookings (id, student_id, trial_class_id, status, created_at, updated_at, confirmed_at)
       VALUES (:id, :studentId, :trialClassId, :status, :now, :now, :confirmedAt)`,
      { id, studentId, trialClassId, status, now, confirmedAt: status === 'confirmed' ? now : null },
    );
  const attempt = (label: string, write: () => void) => {
    try {
      write();
      console.log(`   ${label}: ${styleText('red', 'accepted (this should never happen)')}`);
    } catch (error) {
      console.log(`   ${label}: ${styleText('green', 'rejected')} (${(error as Error).message})`);
    }
  };
  attempt('Confirm a 5th child into "Magnets: push and pull" (4 of 4)', () =>
    insert('bkg_manual_1', students.zara, classes.magnets, 'confirmed'),
  );
  attempt('Add a second live booking for Leo in "Sink or float?"', () =>
    insert('bkg_manual_2', students.leo, classes.float, 'pending_payment'),
  );
  deps.db.close();
}

try {
  console.log(bold('Last-seat race demo') + styleText('dim', ' (temporary databases; your demo data is untouched)'));
  await scenarioFromTheBrief();
  await crowdAcrossProcesses();
  databaseBackstops();
  console.log();
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
