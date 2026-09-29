import type { Role } from '@trial-booking/shared';

const HOME_PATHS: Record<Role, string> = {
	parent: '/book',
	staff: '/staff',
};

export function homePathFor(role: Role): string {
	return HOME_PATHS[role];
}

function isUnder(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}/`);
}

export function canOpen(role: Role, path: string): boolean {
	return isUnder(path, HOME_PATHS[role]);
}

/** Where to land after signing in: the page that asked for sign-in, if this role may open it. */
export function pathAfterSignIn(role: Role, from: string | null | undefined): string {
	return from && canOpen(role, from) ? from : homePathFor(role);
}
