import type { PaymentJobKind, PaymentJobStatus } from '@trial-booking/shared';
import {
	DataTypes,
	Model,
	type CreationOptional,
	type InferAttributes,
	type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/** Outbox row: a capture or void that must reach the provider. */
export class PaymentJob extends Model<InferAttributes<PaymentJob>, InferCreationAttributes<PaymentJob>> {
	declare id: CreationOptional<string>;
	declare paymentAttemptId: string;
	declare kind: PaymentJobKind;
	declare status: CreationOptional<PaymentJobStatus>;
	declare attempts: CreationOptional<number>;
	declare runAfter: CreationOptional<Date>;
	declare lockedUntil: CreationOptional<Date | null>;
	declare lastError: CreationOptional<string | null>;
	declare createdAt: CreationOptional<Date>;
	declare updatedAt: CreationOptional<Date>;
}

PaymentJob.init(
	{
		id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
		paymentAttemptId: { type: DataTypes.UUID, allowNull: false },
		kind: { type: DataTypes.ENUM('capture', 'void'), allowNull: false },
		status: { type: DataTypes.ENUM('pending', 'done', 'failed'), allowNull: false, defaultValue: 'pending' },
		attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
		runAfter: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
		lockedUntil: { type: DataTypes.DATE, allowNull: true },
		lastError: { type: DataTypes.TEXT, allowNull: true },
		createdAt: DataTypes.DATE,
		updatedAt: DataTypes.DATE,
	},
	{ sequelize, modelName: 'PaymentJob', tableName: 'payment_jobs' },
);
