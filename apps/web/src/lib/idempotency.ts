export type RandomSource = Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => string };

/**
 * A fresh key for each payment click. `crypto.randomUUID` only exists in secure
 * contexts (HTTPS or localhost), so plain HTTP falls back to a v4 UUID built from
 * `getRandomValues`, which is available everywhere.
 */
export function newIdempotencyKey(source: RandomSource = globalThis.crypto): string {
	if (typeof source.randomUUID === 'function') {
		return source.randomUUID();
	}
	const bytes = source.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
