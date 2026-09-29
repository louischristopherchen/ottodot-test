import { fileURLToPath } from 'node:url';

export const DB_PATH = process.env.DB_PATH ?? fileURLToPath(new URL('../data/trial-booking.db', import.meta.url));
