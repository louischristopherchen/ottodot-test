import type { Subject } from '@trial-booking/shared';
import {
	DataTypes,
	Model,
	type CreationOptional,
	type InferAttributes,
	type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export class TrialClass extends Model<InferAttributes<TrialClass>, InferCreationAttributes<TrialClass>> {
	declare id: CreationOptional<string>;
	declare subject: Subject;
	declare title: string;
	declare teacherName: string;
	declare startsAt: Date;
	declare durationMinutes: number;
	declare capacity: CreationOptional<number>;
	/** Maintained by a database trigger from the bookings table. Never written by application code. */
	declare confirmedCount: CreationOptional<number>;
	declare priceCents: number;
	declare currency: CreationOptional<string>;
	declare createdAt: CreationOptional<Date>;
	declare updatedAt: CreationOptional<Date>;
}

TrialClass.init(
	{
		id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
		subject: { type: DataTypes.ENUM('math', 'science'), allowNull: false },
		title: { type: DataTypes.STRING(160), allowNull: false },
		teacherName: { type: DataTypes.STRING(120), allowNull: false },
		startsAt: { type: DataTypes.DATE, allowNull: false },
		durationMinutes: { type: DataTypes.INTEGER, allowNull: false },
		capacity: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 4 },
		confirmedCount: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
		priceCents: { type: DataTypes.INTEGER, allowNull: false },
		currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: 'SGD' },
		createdAt: DataTypes.DATE,
		updatedAt: DataTypes.DATE,
	},
	{ sequelize, modelName: 'TrialClass', tableName: 'trial_classes' },
);
