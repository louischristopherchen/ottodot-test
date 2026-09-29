'use strict';

/**
 * Users (parents and staff) and their sessions.
 *
 * Sessions hold rotating refresh tokens. Only the SHA-256 of the opaque token is
 * stored. Presenting a token that was already rotated revokes the whole family
 * (reuse detection), except within a short grace window for two tabs refreshing
 * at the same moment.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		await queryInterface.createTable('users', {
			id: {
				type: Sequelize.UUID,
				primaryKey: true,
				allowNull: false,
				defaultValue: Sequelize.literal('gen_random_uuid()'),
			},
			email: { type: Sequelize.STRING(254), allowNull: false },
			name: { type: Sequelize.STRING(120), allowNull: false },
			role: { type: Sequelize.ENUM('parent', 'staff'), allowNull: false },
			password_hash: { type: Sequelize.STRING(100), allowNull: false },
			failed_login_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
			locked_until: { type: Sequelize.DATE, allowNull: true },
			created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
			updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
		});

		// Case-insensitive uniqueness without the citext extension.
		await queryInterface.sequelize.query('CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email))');

		await queryInterface.createTable('sessions', {
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
			family_id: { type: Sequelize.UUID, allowNull: false },
			refresh_token_hash: { type: Sequelize.CHAR(64), allowNull: false },
			replaced_by_id: { type: Sequelize.UUID, allowNull: true },
			user_agent: { type: Sequelize.STRING(255), allowNull: true },
			ip: { type: Sequelize.STRING(64), allowNull: true },
			expires_at: { type: Sequelize.DATE, allowNull: false },
			revoked_at: { type: Sequelize.DATE, allowNull: true },
			revoked_reason: {
				type: Sequelize.ENUM('logout', 'rotated', 'reuse_detected', 'expired'),
				allowNull: true,
			},
			created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
			updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
		});

		await queryInterface.addIndex('sessions', ['refresh_token_hash'], {
			name: 'sessions_refresh_token_hash_unique',
			unique: true,
		});
		await queryInterface.addIndex('sessions', ['family_id'], { name: 'sessions_family_id' });
		await queryInterface.addIndex('sessions', ['expires_at'], { name: 'sessions_expires_at' });
	},

	async down(queryInterface) {
		await queryInterface.dropTable('sessions');
		await queryInterface.dropTable('users');
		await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_sessions_revoked_reason');
		await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_users_role');
	},
};
