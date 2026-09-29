import { randomBytes } from 'node:crypto';

// bcryptjs rather than the native bcrypt binding: same format, no native build to break installs.
import bcrypt from 'bcryptjs';

import { env } from '../../config/env.js';

export function hashPassword(password: string, cost = env.BCRYPT_COST): Promise<string> {
	return bcrypt.hash(password, cost);
}

let dummyHash: Promise<string> | undefined;

/**
 * Compares against a throwaway hash when the email is unknown, so an unknown email
 * and a wrong password take the same time and cannot be told apart.
 */
export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
	dummyHash ??= bcrypt.hash(randomBytes(16).toString('hex'), env.BCRYPT_COST);
	const matches = await bcrypt.compare(password, hash ?? (await dummyHash));
	return hash !== null && matches;
}
