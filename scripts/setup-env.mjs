// Creates .env from .env.example with fresh random secrets. Never overwrites an existing .env.
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = `${root}.env`;

if (existsSync(target)) {
	console.log('.env already exists; left as it is.');
	process.exit(0);
}

copyFileSync(`${root}.env.example`, target);
const providerKey = randomBytes(24).toString('base64url');
const content = readFileSync(target, 'utf8')
	.replace(/^JWT_SECRET=change-me$/m, `JWT_SECRET=${randomBytes(48).toString('base64url')}`)
	.replace(/^PAYMENT_PROVIDER_API_KEY=change-me$/m, `PAYMENT_PROVIDER_API_KEY=${providerKey}`)
	.replace(/^SANDBOX_API_KEY=change-me$/m, `SANDBOX_API_KEY=${providerKey}`);
writeFileSync(target, content);
// copyFileSync keeps the example's mode, and writeFileSync ignores `mode` for an existing file.
chmodSync(target, 0o600);
console.log('Created .env with random secrets.');
