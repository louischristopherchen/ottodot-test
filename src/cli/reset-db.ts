// Wipes the demo database and loads fresh seed data, with class times
// relative to now. Safe to run while the server is running.

import { DB_PATH } from '../config.ts';
import { openDatabase } from '../db/database.ts';
import { resetDemoData } from '../db/seed.ts';

const db = openDatabase(DB_PATH);
resetDemoData(db, new Date());
db.close();
console.log(`Demo data reset in ${DB_PATH}`);
