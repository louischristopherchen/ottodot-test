import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { API_ENV } from './support/env';

/** Brings the e2e database schema up to date once per run. Each test then reseeds it. */
export default function globalSetup(): void {
	execFileSync(process.execPath, [require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate'], {
		cwd: path.resolve(__dirname, '../apps/api'),
		env: { ...process.env, NODE_ENV: 'e2e', E2E_DATABASE_URL: API_ENV.DATABASE_URL },
		stdio: 'inherit',
	});
}
