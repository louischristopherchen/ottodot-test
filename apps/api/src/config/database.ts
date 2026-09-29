import { Sequelize } from 'sequelize';

import { env } from './env.js';

export const sequelize = new Sequelize(env.DATABASE_URL, {
	dialect: 'postgres',
	logging: false,
	define: {
		timestamps: true,
		underscored: true,
	},
	pool: {
		max: env.DB_POOL_MAX,
		min: 0,
		acquire: 30_000,
		idle: 10_000,
	},
});

export async function connectDatabase(): Promise<void> {
	await sequelize.authenticate();
}

export async function closeDatabase(): Promise<void> {
	await sequelize.close();
}
