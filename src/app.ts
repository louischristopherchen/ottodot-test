import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { createBooking, payForBooking, type PaymentOutcome } from './domain/bookings.ts';
import { AppError } from './domain/errors.ts';
import {
  findParent,
  getBookingForParent,
  getRoster,
  listBookingsForParent,
  listFamilies,
  listUpcomingTrialClasses,
} from './domain/queries.ts';
import type { Deps } from './domain/types.ts';
import { TEST_CARD_IDS, TEST_CARDS } from './payments/provider.ts';

/**
 * Mock authentication: the caller says who they are in the `x-user-id`
 * header (a parent id, or STAFF_USER_ID). A real deployment would read the
 * user from a session or token; authorization checks below stay the same.
 */
export const STAFF_USER_ID = 'staff_ops';

const PAYMENT_OUTCOME_HTTP_STATUS: Record<PaymentOutcome, number> = {
  confirmed: 200,
  payment_declined: 402,
  class_full: 409,
  booking_closed: 409,
  already_confirmed: 409,
};

const createBookingBody = z.object({
  studentId: z.string().min(1).max(100),
  trialClassId: z.string().min(1).max(100),
});

const payBody = z.object({
  paymentMethod: z.enum(TEST_CARD_IDS),
});

export function createApp(deps: Deps): express.Express {
  const { db } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(fileURLToPath(new URL('../web', import.meta.url))));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Demo only: feeds the "signed in as" switcher in the UI.
  app.get('/api/demo/users', (_req, res) => {
    res.json({
      parents: listFamilies(db),
      staff: [{ id: STAFF_USER_ID, name: 'Ottodot staff (rosters)' }],
      testCards: Object.entries(TEST_CARDS).map(([id, card]) => ({ id, ...card })),
    });
  });

  app.get('/api/trial-classes', (_req, res) => {
    res.json({ trialClasses: listUpcomingTrialClasses(db, deps.now()) });
  });

  app.post('/api/bookings', (req, res) => {
    const parentId = requireParent(req);
    const input = parse(createBookingBody, req.body);
    const { booking, created } = createBooking(deps, parentId, input);
    res.status(created ? 201 : 200).json({ booking });
  });

  app.get('/api/bookings', (req, res) => {
    const parentId = requireParent(req);
    res.json({ bookings: listBookingsForParent(db, parentId) });
  });

  app.get('/api/bookings/:bookingId', (req, res) => {
    const parentId = requireParent(req);
    res.json({ booking: getBookingForParent(db, parentId, req.params.bookingId) });
  });

  app.post('/api/bookings/:bookingId/payments', async (req, res) => {
    const parentId = requireParent(req);
    const { paymentMethod } = parse(payBody, req.body);
    const result = await payForBooking(deps, parentId, req.params.bookingId, paymentMethod);
    res.status(PAYMENT_OUTCOME_HTTP_STATUS[result.outcome]).json(result);
  });

  app.get('/api/staff/trial-classes/:trialClassId/roster', (req, res) => {
    requireStaff(req);
    res.json(getRoster(db, req.params.trialClassId));
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint.' } });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.httpStatus).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (isJsonSyntaxError(error)) {
      res.status(400).json({ error: { code: 'validation_error', message: 'Request body is not valid JSON.' } });
      return;
    }
    console.error(error);
    res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong.' } });
  });

  function requireParent(req: Request): string {
    const userId = req.header('x-user-id');
    if (!userId) throw new AppError('unauthenticated', 'Sign in first (x-user-id header).');
    if (userId === STAFF_USER_ID) throw new AppError('forbidden', 'Only parents can book trial classes.');
    if (!findParent(db, userId)) throw new AppError('unauthenticated', 'Unknown user.');
    return userId;
  }

  function requireStaff(req: Request): void {
    const userId = req.header('x-user-id');
    if (!userId) throw new AppError('unauthenticated', 'Sign in first (x-user-id header).');
    if (userId !== STAFF_USER_ID) throw new AppError('forbidden', 'Rosters are for Ottodot staff only.');
  }

  return app;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const detail = result.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`);
    throw new AppError('validation_error', `Invalid request. ${detail.join('; ')}`);
  }
  return result.data;
}

function isJsonSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError && (error as { type?: string }).type === 'entity.parse.failed';
}
