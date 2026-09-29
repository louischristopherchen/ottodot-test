// Pays for one booking in its own OS process, with its own database
// connection, the way separate server instances would. Used by the
// multi-process race test and by `npm run demo:race` to show the seat claim
// holds across processes, not only across async calls inside one process.
//
// Worker usage: node src/cli/pay-worker.ts <dbPath> <parentId> <bookingId> <startAtMs> <latencyMs>

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { openDatabase } from '../db/database.ts';
import { payForBooking, type PaymentOutcome } from '../domain/bookings.ts';
import { MockPaymentProvider } from '../payments/mock-provider.ts';

export interface PaymentJob {
  parentId: string;
  bookingId: string;
}

export interface WorkerResult {
  pid: number;
  bookingId: string;
  outcome: PaymentOutcome;
  attemptStatus: string | null;
}

/**
 * Starts one process per job. All of them wait for the same start time, then
 * pay at once, so their authorizations overlap and they reach the seat claim
 * together.
 */
export function runPaymentsInParallelProcesses(
  dbPath: string,
  jobs: PaymentJob[],
  options: { latencyMs?: number; bootMs?: number } = {},
): Promise<WorkerResult[]> {
  const startAt = Date.now() + (options.bootMs ?? 1500);
  const latencyMs = options.latencyMs ?? 200;
  return Promise.all(jobs.map((job) => runWorker(dbPath, job, startAt, latencyMs)));
}

function runWorker(dbPath: string, job: PaymentJob, startAt: number, latencyMs: number): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const args = [fileURLToPath(import.meta.url), dbPath, job.parentId, job.bookingId, String(startAt), String(latencyMs)];
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`payment worker for ${job.bookingId} exited with code ${code}`));
      resolve(JSON.parse(output) as WorkerResult);
    });
  });
}

if (import.meta.main) {
  const [dbPath, parentId, bookingId, startAt, latencyMs] = process.argv.slice(2);
  if (!dbPath || !parentId || !bookingId || !startAt || !latencyMs) {
    console.error('usage: pay-worker.ts <dbPath> <parentId> <bookingId> <startAtMs> <latencyMs>');
    process.exit(2);
  }
  const db = openDatabase(dbPath);
  const deps = {
    db,
    payments: new MockPaymentProvider({ latencyMs: Number(latencyMs) }),
    now: () => new Date(),
  };
  await sleep(Math.max(0, Number(startAt) - Date.now()));
  const result = await payForBooking(deps, parentId, bookingId, 'pm_card_visa');
  db.close();
  const output: WorkerResult = {
    pid: process.pid,
    bookingId,
    outcome: result.outcome,
    attemptStatus: result.paymentAttempt?.status ?? null,
  };
  process.stdout.write(JSON.stringify(output));
}
