import { useStore } from 'zustand';

import { sessionStore, type SessionState } from '@/stores/session';

export function useSession<T>(selector: (state: SessionState) => T): T {
	return useStore(sessionStore, selector);
}
