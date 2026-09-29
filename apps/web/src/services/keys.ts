export const queryKeys = {
	students: ['students'] as const,
	trialClasses: ['trial-classes'] as const,
	bookings: ['bookings'] as const,
	roster: (trialClassId: string) => ['roster', trialClassId] as const,
};

/** Classes, bookings and rosters poll so two windows racing for the last seat stay current. */
export const LIVE_REFETCH_MS = 3_000;
