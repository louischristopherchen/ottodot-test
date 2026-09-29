import { Booking } from './booking.model.js';
import { IdempotencyKey } from './idempotency-key.model.js';
import { PaymentAttempt } from './payment-attempt.model.js';
import { PaymentJob } from './payment-job.model.js';
import { Session } from './session.model.js';
import { Student } from './student.model.js';
import { TrialClass } from './trial-class.model.js';
import { User } from './user.model.js';

User.hasMany(Student, { foreignKey: 'parentId', as: 'children' });
Student.belongsTo(User, { foreignKey: 'parentId', as: 'parent' });

User.hasMany(Session, { foreignKey: 'userId', as: 'sessions' });
Session.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Student.hasMany(Booking, { foreignKey: 'studentId', as: 'bookings' });
Booking.belongsTo(Student, { foreignKey: 'studentId', as: 'student' });

TrialClass.hasMany(Booking, { foreignKey: 'trialClassId', as: 'bookings' });
Booking.belongsTo(TrialClass, { foreignKey: 'trialClassId', as: 'trialClass' });

Booking.hasMany(PaymentAttempt, { foreignKey: 'bookingId', as: 'paymentAttempts' });
PaymentAttempt.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' });

PaymentAttempt.hasMany(PaymentJob, { foreignKey: 'paymentAttemptId', as: 'jobs' });
PaymentJob.belongsTo(PaymentAttempt, { foreignKey: 'paymentAttemptId', as: 'paymentAttempt' });

export { Booking, IdempotencyKey, PaymentAttempt, PaymentJob, Session, Student, TrialClass, User };
