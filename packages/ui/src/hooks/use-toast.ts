import * as React from 'react';

import type { ToastVariant } from '../components/toast';

export interface ToastMessage {
	id: string;
	title: string;
	description?: string;
	variant?: ToastVariant;
	open: boolean;
}

export type ToastInput = Omit<ToastMessage, 'id' | 'open'>;

const TOAST_LIMIT = 3;
// Long enough for the Radix exit animation to finish before the node is dropped.
const REMOVE_DELAY_MS = 300;

let toasts: ToastMessage[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function emit(next: ToastMessage[]): void {
	toasts = next;
	for (const listener of listeners) {
		listener();
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getSnapshot(): ToastMessage[] {
	return toasts;
}

export function dismissToast(id: string): void {
	emit(toasts.map((item) => (item.id === id ? { ...item, open: false } : item)));
	setTimeout(() => {
		emit(toasts.filter((item) => item.id !== id));
	}, REMOVE_DELAY_MS);
}

/** Shows a toast from anywhere, including outside React components. */
export function toast(input: ToastInput): string {
	nextId += 1;
	const id = String(nextId);
	emit([{ ...input, id, open: true }, ...toasts].slice(0, TOAST_LIMIT));
	return id;
}

export function useToast() {
	const items = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	return { toasts: items, toast, dismiss: dismissToast };
}
