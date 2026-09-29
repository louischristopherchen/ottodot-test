import {
	DataTypes,
	Model,
	type CreationOptional,
	type InferAttributes,
	type InferCreationAttributes,
	type NonAttribute,
} from 'sequelize';

import { sequelize } from '../config/database.js';
import type { User } from './user.model.js';

export class Student extends Model<InferAttributes<Student>, InferCreationAttributes<Student>> {
	declare id: CreationOptional<string>;
	declare parentId: string;
	declare name: string;
	/** Primary 1 to 6. */
	declare level: number;
	declare createdAt: CreationOptional<Date>;
	declare updatedAt: CreationOptional<Date>;

	declare parent?: NonAttribute<User>;
}

Student.init(
	{
		id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
		parentId: { type: DataTypes.UUID, allowNull: false },
		name: { type: DataTypes.STRING(120), allowNull: false },
		level: { type: DataTypes.SMALLINT, allowNull: false },
		createdAt: DataTypes.DATE,
		updatedAt: DataTypes.DATE,
	},
	{ sequelize, modelName: 'Student', tableName: 'students' },
);
