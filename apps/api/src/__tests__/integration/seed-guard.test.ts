import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';

import { sequelize } from '../../config/database.js';
import { closePool } from '../support/harness.js';

// The seed script creates accounts with a published password. It must refuse a database
// marked as production or staging, whatever NODE_ENV the machine running it has.

const seedScript = fileURLToPath(new URL('../../scripts/seed.ts', import.meta.url));

function runSeed(extraEnv: Record<string, string> = {}) {
	return spawnSync(process.execPath, ['--import', 'tsx', seedScript, '--reset'], {
		env: { ...process.env, NODE_ENV: 'development', ...extraEnv },
		encoding: 'utf8',
	});
}

async function markDatabase(comment: string | null) {
	const [rows] = await sequelize.query('SELECT current_database() AS name');
	const name = (rows as { name: string }[])[0]!.name;
	await sequelize.query(`COMMENT ON DATABASE "${name}" IS ${comment === null ? 'NULL' : `'${comment}'`}`);
}

after(async () => {
	await markDatabase(null);
	await closePool();
});

describe('demo seed guard', () => {
	test('should refuse to reset a database marked as production, even from a development machine', async () => {
		await markDatabase('environment=production');
		const result = runSeed();
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Refusing to seed or reset a production database/);
	});

	test('should seed a marked database only when ALLOW_DEMO_SEED is set on purpose', async () => {
		await markDatabase('environment=staging');
		assert.equal(runSeed().status, 1);
		assert.equal(runSeed({ ALLOW_DEMO_SEED: 'true' }).status, 0);
	});
});
