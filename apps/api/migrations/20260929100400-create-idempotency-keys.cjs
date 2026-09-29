'use strict';

/**
 * Idempotency keys for POST /api/bookings/:id/payments.
 *
 * The first request with a key inserts a row in `in_progress`; the unique index
 * makes a concurrent retry with the same key fail fast instead of paying twice.
 * Once finished, the response is stored and replayed for later retries.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		await queryInterface.createTable('idempotency_keys', {
			id: {
				type: Sequelize.UUID,
				primaryKey: true,
				allowNull: false,
				defaultValue: Sequelize.literal('gen_random_uuid()'),
			},
			user_id: {
				type: Sequelize.UUID,
				allowNull: false,
				references: { model: 'users', key: 'id' },
				onDelete: 'CASCADE',
				onUpdate: 'CASCADE',
			},
			key: { type: Sequelize.STRING(100), allowNull: false },
			request_hash: { type: Sequelize.CHAR(64), allowNull: false },
			state: { type: Sequelize.ENUM('in_progress', 'completed'), allowNull: false },
			response_status: { type: Sequelize.INTEGER, allowNull: true },
			response_body: { type: Sequelize.JSONB, allowNull: true },
			created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
			updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
		});
		await queryInterface.addIndex('idempotency_keys', ['user_id', 'key'], {
			name: 'idempotency_keys_user_key_unique',
			unique: true,
		});
		await queryInterface.addIndex('idempotency_keys', ['created_at'], { name: 'idempotency_keys_created_at' });
	},

	async down(queryInterface) {
		await queryInterface.dropTable('idempotency_keys');
		await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_idempotency_keys_state');
	},
};
