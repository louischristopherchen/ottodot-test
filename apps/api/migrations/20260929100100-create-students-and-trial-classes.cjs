'use strict';

/**
 * Students (a parent's children) and trial classes.
 *
 * trial_classes.confirmed_count is never written by application code: a trigger on
 * bookings keeps it equal to the number of confirmed bookings (next migration), and
 * the CHECK below makes a fifth confirmed seat in a four-seat class impossible.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		await queryInterface.createTable('students', {
			id: {
				type: Sequelize.UUID,
				primaryKey: true,
				allowNull: false,
				defaultValue: Sequelize.literal('gen_random_uuid()'),
			},
			parent_id: {
				type: Sequelize.UUID,
				allowNull: false,
				references: { model: 'users', key: 'id' },
				onDelete: 'RESTRICT',
				onUpdate: 'CASCADE',
			},
			name: { type: Sequelize.STRING(120), allowNull: false },
			level: { type: Sequelize.SMALLINT, allowNull: false },
			created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
			updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
		});
		await queryInterface.addIndex('students', ['parent_id'], { name: 'students_parent_id' });
		await queryInterface.sequelize.query(
			'ALTER TABLE students ADD CONSTRAINT students_level_primary CHECK (level BETWEEN 1 AND 6)',
		);

		await queryInterface.createTable('trial_classes', {
			id: {
				type: Sequelize.UUID,
				primaryKey: true,
				allowNull: false,
				defaultValue: Sequelize.literal('gen_random_uuid()'),
			},
			subject: { type: Sequelize.ENUM('math', 'science'), allowNull: false },
			title: { type: Sequelize.STRING(160), allowNull: false },
			teacher_name: { type: Sequelize.STRING(120), allowNull: false },
			starts_at: { type: Sequelize.DATE, allowNull: false },
			duration_minutes: { type: Sequelize.INTEGER, allowNull: false },
			capacity: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 4 },
			confirmed_count: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 0 },
			price_cents: { type: Sequelize.INTEGER, allowNull: false },
			currency: { type: Sequelize.CHAR(3), allowNull: false, defaultValue: 'SGD' },
			created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
			updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
		});
		await queryInterface.addIndex('trial_classes', ['starts_at'], { name: 'trial_classes_starts_at' });
		await queryInterface.sequelize.query(`
			ALTER TABLE trial_classes
				ADD CONSTRAINT trial_classes_capacity_range CHECK (capacity BETWEEN 1 AND 4),
				ADD CONSTRAINT trial_classes_confirmed_within_capacity CHECK (confirmed_count BETWEEN 0 AND capacity),
				ADD CONSTRAINT trial_classes_price_not_negative CHECK (price_cents >= 0),
				ADD CONSTRAINT trial_classes_duration_positive CHECK (duration_minutes > 0)
		`);
	},

	async down(queryInterface) {
		await queryInterface.dropTable('trial_classes');
		await queryInterface.dropTable('students');
		await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_trial_classes_subject');
	},
};
