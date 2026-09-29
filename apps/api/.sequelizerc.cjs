/**
 * sequelize-cli database config (CommonJS: loaded by the CLI, not by the ESM app).
 * Values come from the environment; the defaults point at the project-local
 * Postgres started by `npm run db:start`.
 */
const fs = require('fs');
const path = require('path');

try {
	const dotenv = require('dotenv');
	for (const candidate of [path.resolve(__dirname, '../../.env'), path.resolve(__dirname, '.env')]) {
		if (fs.existsSync(candidate)) {
			dotenv.config({ path: candidate, override: false });
		}
	}
} catch (error) {
	console.warn('[sequelize-cli] dotenv not loaded, using the process environment:', error.message);
}

const LOCAL = 'postgres://postgres@127.0.0.1:55432';

function config(url) {
	return { url, dialect: 'postgres', logging: false, migrationStorageTableName: 'sequelize_meta' };
}

module.exports = {
	development: config(process.env.DATABASE_URL || `${LOCAL}/trial_booking`),
	test: config(process.env.TEST_DATABASE_URL || `${LOCAL}/trial_booking_test`),
	e2e: config(process.env.E2E_DATABASE_URL || `${LOCAL}/trial_booking_e2e`),
	staging: config(process.env.DATABASE_URL),
	production: config(process.env.DATABASE_URL),
};
