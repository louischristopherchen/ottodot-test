import type { HelmetOptions } from 'helmet';

/**
 * The API only returns JSON, so its responses need no scripts, styles or frames.
 * nginx sets the headers for the web app itself.
 */
export const helmetOptions: HelmetOptions = {
	contentSecurityPolicy: {
		useDefaults: false,
		directives: {
			defaultSrc: ["'none'"],
			frameAncestors: ["'none'"],
			baseUri: ["'none'"],
			formAction: ["'none'"],
		},
	},
	crossOriginResourcePolicy: { policy: 'same-site' },
	referrerPolicy: { policy: 'no-referrer' },
	frameguard: { action: 'deny' },
	strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true },
};
