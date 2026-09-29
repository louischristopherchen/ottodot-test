'use strict';

/**
 * Two changes from the security review.
 *
 * 1. The per-account lockout is removed. Anyone who knew a parent's email could keep
 *    that parent locked out, and a lockout answer revealed that the account existed.
 *    Login is now throttled by rate limits keyed on the IP, the IP and email pair, and
 *    the email string, which behave the same for accounts that do not exist.
 * 2. Every session family gets an absolute expiry (SESSION_MAX_AGE_DAYS from sign-in).
 *    Refresh rotation can no longer extend a sign-in forever, and rotated rows are kept
 *    until the family expires so reuse of an old token is still detected.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		await queryInterface.removeColumn('users', 'failed_login_count');
		await queryInterface.removeColumn('users', 'locked_until');

		await queryInterface.addColumn('sessions', 'family_expires_at', { type: Sequelize.DATE, allowNull: true });
		await queryInterface.sequelize.query('UPDATE sessions SET family_expires_at = expires_at');
		await queryInterface.changeColumn('sessions', 'family_expires_at', { type: Sequelize.DATE, allowNull: false });
		await queryInterface.addIndex('sessions', ['family_expires_at'], { name: 'sessions_family_expires_at' });
	},

	async down(queryInterface, Sequelize) {
		await queryInterface.removeIndex('sessions', 'sessions_family_expires_at');
		await queryInterface.removeColumn('sessions', 'family_expires_at');
		await queryInterface.addColumn('users', 'failed_login_count', {
			type: Sequelize.INTEGER,
			allowNull: false,
			defaultValue: 0,
		});
		await queryInterface.addColumn('users', 'locked_until', { type: Sequelize.DATE, allowNull: true });
	},
};
