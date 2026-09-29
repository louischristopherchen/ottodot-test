// Prints trial class rosters from the demo database.
//   npm run roster                    every upcoming class
//   npm run roster -- cls_fractions   one class

import { DB_PATH } from '../config.ts';
import { openDatabase } from '../db/database.ts';
import { getRoster, listUpcomingTrialClasses } from '../domain/queries.ts';
import { formatSgt, table } from './format.ts';

const db = openDatabase(DB_PATH);
const requested = process.argv[2];
const classIds = requested ? [requested] : listUpcomingTrialClasses(db, new Date()).map((c) => c.id);

if (classIds.length === 0) {
  console.log('No upcoming classes. Run `npm start` (seeds on first run) or `npm run db:reset`.');
}

for (const classId of classIds) {
  const { trialClass, confirmed, notOnRoster } = getRoster(db, classId);
  console.log(`\n${trialClass.title} (${trialClass.subject}, ${trialClass.id})`);
  console.log(`  ${formatSgt(trialClass.startsAt)} with ${trialClass.teacherName}`);
  console.log(`  Confirmed: ${trialClass.confirmedCount} of ${trialClass.capacity}, ${trialClass.seatsLeft} seat(s) left\n`);
  if (confirmed.length === 0) {
    console.log('  (nobody confirmed yet)');
  } else {
    console.log(
      table(
        ['#', 'Child', 'Level', 'Parent', 'Email'],
        confirmed.map((entry, index) => [
          String(index + 1),
          entry.studentName,
          `P${entry.level}`,
          entry.parentName,
          entry.parentEmail,
        ]),
      ),
    );
  }
  if (notOnRoster.length > 0) {
    console.log('\n  Not on the roster:');
    console.log(
      table(
        ['Child', 'Booking status', 'Last payment'],
        notOnRoster.map((entry) => [
          entry.studentName,
          entry.cancelReason ? `${entry.status} (${entry.cancelReason})` : entry.status,
          entry.lastPaymentStatus
            ? `${entry.lastPaymentStatus}${entry.lastPaymentFailureCode ? ` (${entry.lastPaymentFailureCode})` : ''}`
            : 'none',
        ]),
        '    ',
      ),
    );
  }
}
db.close();
