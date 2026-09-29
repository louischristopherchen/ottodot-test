import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';

import { sequelize } from '../../config/database.js';
import { Booking } from '../../models/index.js';
import { closePool, confirmedCount, startHarness, type Harness } from '../support/harness.js';

let h: Harness;
beforeEach(async () => {
	h = await startHarness();
});
afterEach(async () => {
	await h.close();
});
after(closePool);

function book(token: string, studentId: string, trialClassId: string) {
	return h.request('POST', '/api/bookings', { token, body: { studentId, trialClassId } });
}

describe('booking a trial class', () => {
	test('should list upcoming classes with their seat counts', async () => {
		const response = await h.request('GET', '/api/trial-classes', { token: h.tokens.aisha });
		const seats = Object.fromEntries(
			response.body.data.map((c: { title: string; seatsLeft: number }) => [c.title, c.seatsLeft]),
		);
		assert.deepEqual(seats, {
			'Sink or float? Investigating buoyancy': 3,
			'Fractions with pizza': 1,
			'Magnets: push and pull': 0,
			'Number patterns and puzzles': 4,
		});
	});

	test("should list only the parent's own children", async () => {
		const response = await h.request('GET', '/api/students', { token: h.tokens.aisha });
		assert.deepEqual(
			response.body.data.map((student: { name: string }) => student.name),
			['Idris Rahman', 'Zara Rahman'],
		);
	});

	test('should create an unpaid booking that holds no seat', async () => {
		const response = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.fractions);

		assert.equal(response.status, 201);
		assert.equal(response.body.data.created, true);
		assert.equal(response.body.data.booking.status, 'pending_payment');
		assert.equal(await confirmedCount(h.ids.classes.fractions), 3);
	});

	test('should return the same unpaid booking when the parent books the same child and class again', async () => {
		const first = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);
		const second = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);

		assert.equal(second.status, 200);
		assert.equal(second.body.data.created, false);
		assert.equal(second.body.data.booking.id, first.body.data.booking.id);
	});

	test('should create one booking when two identical requests arrive together', async () => {
		const results = await Promise.all([
			book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.patterns),
			book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.patterns),
		]);

		assert.equal(results[0]!.body.data.booking.id, results[1]!.body.data.booking.id);
		assert.equal(await Booking.count({ where: { studentId: h.ids.students.zara, trialClassId: h.ids.classes.patterns } }), 1);
	});

	test('should refuse a duplicate when the child already has a confirmed seat', async () => {
		const response = await book(h.tokens.ben, h.ids.students.leo, h.ids.classes.float);

		assert.equal(response.status, 409);
		assert.equal(response.body.error.code, 'ALREADY_BOOKED');
		assert.equal(response.body.error.message, 'Leo Carter already has a confirmed seat in this class.');
	});

	test("should treat another family's child as not found", async () => {
		const response = await book(h.tokens.aisha, h.ids.students.leo, h.ids.classes.patterns);
		assert.equal(response.status, 404);
	});

	test('should refuse a full class', async () => {
		const response = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.magnets);
		assert.equal(response.status, 409);
		assert.equal(response.body.error.code, 'CLASS_FULL');
	});

	test('should refuse a class that has already started', async () => {
		await sequelize.query("UPDATE trial_classes SET starts_at = now() - interval '5 minutes' WHERE id = :id", {
			replacements: { id: h.ids.classes.patterns },
		});
		const response = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.patterns);
		assert.equal(response.status, 409);
		assert.equal(response.body.error.code, 'BOOKING_CLOSED');
	});

	test("should list only the parent's bookings and hide another family's booking", async () => {
		const mine = await book(h.tokens.aisha, h.ids.students.zara, h.ids.classes.float);

		const list = await h.request('GET', '/api/bookings', { token: h.tokens.aisha });
		assert.ok(list.body.data.every((booking: { student: { name: string } }) => booking.student.name.endsWith('Rahman')));
		assert.equal(list.body.data[0].id, mine.body.data.booking.id, 'newest first');

		const peek = await h.request('GET', `/api/bookings/${mine.body.data.booking.id}`, { token: h.tokens.chloe });
		assert.equal(peek.status, 404);
	});

	test('should validate the request body', async () => {
		const response = await h.request('POST', '/api/bookings', {
			token: h.tokens.aisha,
			body: { studentId: 'not-a-uuid' },
		});
		assert.equal(response.status, 400);
		assert.equal(response.body.error.code, 'VALIDATION_ERROR');
		assert.ok(response.body.error.details?.studentId);
		assert.ok(response.body.error.details?.trialClassId);
	});

	test('should reject an oversized body and malformed JSON with 4xx, not a server error', async () => {
		const tooLarge = await h.request('POST', '/api/bookings', {
			token: h.tokens.aisha,
			rawBody: JSON.stringify({ studentId: 'x'.repeat(20_000) }),
		});
		assert.equal(tooLarge.status, 413);
		assert.equal(tooLarge.body.error.code, 'PAYLOAD_TOO_LARGE');

		const malformed = await h.request('POST', '/api/bookings', { token: h.tokens.aisha, rawBody: '{"studentId":' });
		assert.equal(malformed.status, 400);
	});
});
