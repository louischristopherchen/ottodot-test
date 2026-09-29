import {
	DataTypes,
	Model,
	type CreationOptional,
	type InferAttributes,
	type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export class IdempotencyKey extends Model<InferAttributes<IdempotencyKey>, InferCreationAttributes<IdempotencyKey>> {
	declare id: CreationOptional<string>;
	declare userId: string;
	declare key: string;
	declare requestHash: string;
	declare state: 'in_progress' | 'completed';
	declare responseStatus: CreationOptional<number | null>;
	declare responseBody: CreationOptional<object | null>;
	declare createdAt: CreationOptional<Date>;
	declare updatedAt: CreationOptional<Date>;
}

IdempotencyKey.init(
	{
		id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
		userId: { type: DataTypes.UUID, allowNull: false },
		key: { type: DataTypes.STRING(100), allowNull: false },
		requestHash: { type: DataTypes.CHAR(64), allowNull: false },
		state: { type: DataTypes.ENUM('in_progress', 'completed'), allowNull: false },
		responseStatus: { type: DataTypes.INTEGER, allowNull: true },
		responseBody: { type: DataTypes.JSONB, allowNull: true },
		createdAt: DataTypes.DATE,
		updatedAt: DataTypes.DATE,
	},
	{ sequelize, modelName: 'IdempotencyKey', tableName: 'idempotency_keys' },
);
