import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';

import { UniqueConstraintError } from 'sequelize';

import { sequelize } from '../../config/database.js';
import { closePool, confirmedCount, startHarness, type Harness } from '../support/harness.js';

// These tests skip the application and write SQL directly, the way a buggy code path or a
// manual fix by ops would. The schema alone has to hold the line.

let h: Harness;
beforeEach(async () => {
	h = await startHarness();
});
afterEach(async () => {
	await h.close();
});
after(closePool);

async function insertBooking(studentId: string, trialClassId: string, status: string, cancelReason: string | null = null) {
	const [rows] = await sequelize.query(
		`INSERT INTO bookings (id, student_id, trial_class_id, status, cancel_reason, confirmed_at)
		 VALUES (gen_random_uuid(), :studentId, :trialClassId, :status, :cancelReason,
		         CASE WHEN :status = 'confirmed' THEN now() END)
		 RETURNING id`,
		{ replacements: { studentId, trialClassId, status, cancelReason } },
	);
	return (rows as { id: string }[])[0]!.id;
}

describe('database invariants', () => {
	test('should refuse a fifth confirmed booking in a four-seat class', async () => {
		const bookingId = await insertBooking(h.ids.students.zara, h.ids.classes.magnets, 'pending_payment');

		await assert.rejects(
			sequelize.query("UPDATE bookings SET status = 'confirmed', confirmed_at = now() WHERE id = :id", {
				replacements: { id: bookingId },
			}),
			/trial_classes_confirmed_within_capacity/,
		);
		await assert.rejects(
			insertBooking(h.ids.students.ethan, h.ids.classes.magnets, 'confirmed'),
			/trial_classes_confirmed_within_capacity/,
		);
		assert.equal(await confirmedCount(h.ids.classes.magnets), 4);
	});

	test('should allow the last seat but not the one after it', async () => {
		await insertBooking(h.ids.students.zara, h.ids.classes.fractions, 'confirmed');
		await assert.rejects(insertBooking(h.ids.students.ethan, h.ids.classes.fractions, 'confirmed'), /within_capacity/);
	});

	test('should refuse a second live booking for the same child and class', async () => {
		await assert.rejects(
			insertBooking(h.ids.students.leo, h.ids.classes.float, 'pending_payment'),
			(error: unknown) =>
				error instanceof UniqueConstraintError &&
				(error.parent as { constraint?: string }).constraint === 'bookings_one_live_per_student_class',
		);
	});

	test('should let a child book again once the earlier booking is cancelled', async () => {
		await insertBooking(h.ids.students.zara, h.ids.classes.patterns, 'cancelled', 'expired');
		await insertBooking(h.ids.students.zara, h.ids.classes.patterns, 'pending_payment');
	});

	test('should keep confirmed_count equal to the confirmed bookings through confirm, cancel and delete', async () => {
		const bookingId = await insertBooking(h.ids.students.zara, h.ids.classes.patterns, 'confirmed');
		assert.equal(await confirmedCount(h.ids.classes.patterns), 1);

		await sequelize.query(
			"UPDATE bookings SET status = 'payment_failed', confirmed_at = NULL WHERE id = :id",
			{ replacements: { id: bookingId } },
		);
		assert.equal(await confirmedCount(h.ids.classes.patterns), 0);

		await sequelize.query("UPDATE bookings SET status = 'confirmed', confirmed_at = now() WHERE id = :id", {
			replacements: { id: bookingId },
		});
		await sequelize.query('DELETE FROM bookings WHERE id = :id', { replacements: { id: bookingId } });
		assert.equal(await confirmedCount(h.ids.classes.patterns), 0);
	});

	test('should refuse moving a booking to another class', async () => {
		const bookingId = await insertBooking(h.ids.students.zara, h.ids.classes.patterns, 'pending_payment');
		await assert.rejects(
			sequelize.query('UPDATE bookings SET trial_class_id = :other WHERE id = :id', {
				replacements: { id: bookingId, other: h.ids.classes.float },
			}),
			/cannot move to another class/,
		);
	});

	test('should refuse lowering capacity below the confirmed count or above four', async () => {
		await assert.rejects(
			sequelize.query('UPDATE trial_classes SET capacity = 2 WHERE id = :id', {
				replacements: { id: h.ids.classes.fractions },
			}),
			/within_capacity/,
		);
		await assert.rejects(
			sequelize.query('UPDATE trial_classes SET capacity = 5 WHERE id = :id', {
				replacements: { id: h.ids.classes.patterns },
			}),
			/trial_classes_capacity_range/,
		);
	});

	test('should refuse rows whose status fields disagree', async () => {
		await assert.rejects(
			insertBooking(h.ids.students.zara, h.ids.classes.patterns, 'cancelled', null),
			/bookings_cancel_reason_iff_cancelled/,
		);
		await assert.rejects(
			sequelize.query(
				`INSERT INTO bookings (id, student_id, trial_class_id, status)
				 VALUES (gen_random_uuid(), :studentId, :classId, 'confirmed')`,
				{ replacements: { studentId: h.ids.students.zara, classId: h.ids.classes.patterns } },
			),
			/bookings_confirmed_at_iff_confirmed/,
		);
	});
});
