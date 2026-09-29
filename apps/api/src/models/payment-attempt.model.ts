import type { PaymentAttemptStatus } from '@trial-booking/shared';
import {
	DataTypes,
	Model,
	type CreationOptional,
	type InferAttributes,
	type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/** One try at paying for a booking. The id is also the provider idempotency key. */
export class PaymentAttempt extends Model<InferAttributes<PaymentAttempt>, InferCreationAttributes<PaymentAttempt>> {
	declare id: CreationOptional<string>;
	declare bookingId: string;
	declare amountCents: number;
	declare currency: string;
	declare paymentMethod: string;
	declare status: PaymentAttemptStatus;
	declare providerRef: CreationOptional<string | null>;
	declare failureCode: CreationOptional<string | null>;
	declare createdAt: CreationOptional<Date>;
	declare updatedAt: CreationOptional<Date>;
}

PaymentAttempt.init(
	{
		id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
		bookingId: { type: DataTypes.UUID, allowNull: false },
		amountCents: { type: DataTypes.INTEGER, allowNull: false },
		currency: { type: DataTypes.CHAR(3), allowNull: false },
		paymentMethod: { type: DataTypes.STRING(64), allowNull: false },
		status: {
			type: DataTypes.ENUM('processing', 'authorized', 'declined', 'captured', 'voided', 'capture_failed'),
			allowNull: false,
		},
		providerRef: { type: DataTypes.STRING(100), allowNull: true },
		failureCode: { type: DataTypes.STRING(64), allowNull: true },
		createdAt: DataTypes.DATE,
		updatedAt: DataTypes.DATE,
	},
	{ sequelize, modelName: 'PaymentAttempt', tableName: 'payment_attempts' },
);
