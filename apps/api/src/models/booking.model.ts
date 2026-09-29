import type { BookingStatus, CancelReason } from '@trial-booking/shared';
import {
	DataTypes,
	Model,
	type CreationOptional,
	type InferAttributes,
	type InferCreationAttributes,
	type NonAttribute,
} from 'sequelize';

import { sequelize } from '../config/database.js';
import type { PaymentAttempt } from './payment-attempt.model.js';
import type { Student } from './student.model.js';
import type { TrialClass } from './trial-class.model.js';

export class Booking extends Model<InferAttributes<Booking>, InferCreationAttributes<Booking>> {
	declare id: CreationOptional<string>;
	declare studentId: string;
	declare trialClassId: string;
	declare status: BookingStatus;
	declare cancelReason: CreationOptional<CancelReason | null>;
	declare confirmedAt: CreationOptional<Date | null>;
	declare createdAt: CreationOptional<Date>;
	declare updatedAt: CreationOptional<Date>;

	declare student?: NonAttribute<Student>;
	declare trialClass?: NonAttribute<TrialClass>;
	declare paymentAttempts?: NonAttribute<PaymentAttempt[]>;
}

Booking.init(
	{
		id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
		studentId: { type: DataTypes.UUID, allowNull: false },
		trialClassId: { type: DataTypes.UUID, allowNull: false },
		status: {
			type: DataTypes.ENUM('pending_payment', 'payment_failed', 'confirmed', 'cancelled'),
			allowNull: false,
		},
		cancelReason: { type: DataTypes.ENUM('class_full', 'booking_closed', 'expired'), allowNull: true },
		confirmedAt: { type: DataTypes.DATE, allowNull: true },
		createdAt: DataTypes.DATE,
		updatedAt: DataTypes.DATE,
	},
	{ sequelize, modelName: 'Booking', tableName: 'bookings' },
);
