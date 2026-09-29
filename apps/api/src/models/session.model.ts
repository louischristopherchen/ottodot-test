import {
	DataTypes,
	Model,
	type CreationOptional,
	type InferAttributes,
	type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export type SessionRevokedReason = 'logout' | 'rotated' | 'reuse_detected' | 'expired';

/** One refresh token. Rotation revokes this row and creates its successor in the same family. */
export class Session extends Model<InferAttributes<Session>, InferCreationAttributes<Session>> {
	declare id: CreationOptional<string>;
	declare userId: string;
	declare familyId: string;
	declare refreshTokenHash: string;
	declare replacedById: CreationOptional<string | null>;
	declare userAgent: CreationOptional<string | null>;
	declare ip: CreationOptional<string | null>;
	declare expiresAt: Date;
	declare revokedAt: CreationOptional<Date | null>;
	declare revokedReason: CreationOptional<SessionRevokedReason | null>;
	declare createdAt: CreationOptional<Date>;
	declare updatedAt: CreationOptional<Date>;
}

Session.init(
	{
		id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
		userId: { type: DataTypes.UUID, allowNull: false },
		familyId: { type: DataTypes.UUID, allowNull: false },
		refreshTokenHash: { type: DataTypes.CHAR(64), allowNull: false },
		replacedById: { type: DataTypes.UUID, allowNull: true },
		userAgent: { type: DataTypes.STRING(255), allowNull: true },
		ip: { type: DataTypes.STRING(64), allowNull: true },
		expiresAt: { type: DataTypes.DATE, allowNull: false },
		revokedAt: { type: DataTypes.DATE, allowNull: true },
		revokedReason: { type: DataTypes.ENUM('logout', 'rotated', 'reuse_detected', 'expired'), allowNull: true },
		createdAt: DataTypes.DATE,
		updatedAt: DataTypes.DATE,
	},
	{ sequelize, modelName: 'Session', tableName: 'sessions' },
);
