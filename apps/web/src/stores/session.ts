import type { SessionDto, UserDto } from '@trial-booking/shared';
import { createStore } from 'zustand/vanilla';

/**
 * unknown        the startup refresh has not answered yet
 * authenticated  an access token is held in memory
 * anonymous      nobody is signed in
 */
export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

/** Why a signed-in session ended; null when nobody was signed in to begin with. */
export type SessionEndReason = 'signed_out' | 'expired';

export interface SessionState {
	status: SessionStatus;
	accessToken: string | null;
	user: UserDto | null;
	endReason: SessionEndReason | null;
	signIn: (session: SessionDto) => void;
	signOut: (reason: SessionEndReason) => void;
}

// Memory only: the access token must not outlive the tab, and the refresh token lives in an httpOnly cookie.
export const sessionStore = createStore<SessionState>()((set) => ({
	status: 'unknown',
	accessToken: null,
	user: null,
	endReason: null,
	signIn: (session) => {
		set({ status: 'authenticated', accessToken: session.accessToken, user: session.user, endReason: null });
	},
	signOut: (reason) => {
		set((state) => ({
			status: 'anonymous',
			accessToken: null,
			user: null,
			endReason: state.status === 'authenticated' ? reason : null,
		}));
	},
}));
