import type { Role } from '@trial-booking/shared';
import {
	DataTypes,
	Model,
	type CreationOptional,
	type InferAttributes,
	type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
	declare id: CreationOptional<string>;
	declare email: string;
	declare name: string;
	declare role: Role;
	declare passwordHash: string;
	declare failedLoginCount: CreationOptional<number>;
	declare lockedUntil: CreationOptional<Date | null>;
	declare createdAt: CreationOptional<Date>;
	declare updatedAt: CreationOptional<Date>;
}

User.init(
	{
		id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
		email: { type: DataTypes.STRING(254), allowNull: false },
		name: { type: DataTypes.STRING(120), allowNull: false },
		role: { type: DataTypes.ENUM('parent', 'staff'), allowNull: false },
		passwordHash: { type: DataTypes.STRING(100), allowNull: false },
		failedLoginCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
		lockedUntil: { type: DataTypes.DATE, allowNull: true },
		createdAt: DataTypes.DATE,
		updatedAt: DataTypes.DATE,
	},
	{ sequelize, modelName: 'User', tableName: 'users' },
);
