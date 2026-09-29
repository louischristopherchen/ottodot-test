import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { canOpen, homePathFor, pathAfterSignIn } from '../lib/routes';

describe('role routing', () => {
	test('should send parents to /book and staff to /staff when opening /', () => {
		assert.equal(homePathFor('parent'), '/book');
		assert.equal(homePathFor('staff'), '/staff');
	});

	test('should refuse a staff page when the user is a parent', () => {
		assert.equal(canOpen('parent', '/staff'), false);
		assert.equal(canOpen('parent', '/staff/classes/abc'), false);
		assert.equal(canOpen('staff', '/staff/classes/abc'), true);
		assert.equal(canOpen('staff', '/book'), false);
	});

	test('should not treat a lookalike prefix as the same section', () => {
		assert.equal(canOpen('staff', '/staffroom'), false);
	});

	test('should return to the requested page after sign-in when the role may open it', () => {
		assert.equal(pathAfterSignIn('staff', '/staff/classes/abc'), '/staff/classes/abc');
	});

	test('should go home after sign-in when the requested page belongs to the other role', () => {
		assert.equal(pathAfterSignIn('parent', '/staff/classes/abc'), '/book');
		assert.equal(pathAfterSignIn('staff', null), '/staff');
	});
});
