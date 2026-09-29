'use strict';

/**
 * Bookings, with the two booking invariants enforced by the database itself:
 *
 * 1. One live booking per child and class: partial unique index over the live
 *    statuses. Cancelled rows are history, so a child can book again later.
 * 2. Never more confirmed bookings than seats: every change to a confirmed booking
 *    moves trial_classes.confirmed_count through the trigger below, and the CHECK
 *    on that column rejects the fifth seat. The trigger's UPDATE takes the class
 *    row lock, so two transactions confirming at once are serialized per class and
 *    the second one sees the first one's count (safe under READ COMMITTED).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		await queryInterface.createTable('bookings', {
			id: {
				type: Sequelize.UUID,
				primaryKey: true,
				allowNull: false,
				defaultValue: Sequelize.literal('gen_random_uuid()'),
			},
			student_id: {
				type: Sequelize.UUID,
				allowNull: false,
				references: { model: 'students', key: 'id' },
				onDelete: 'RESTRICT',
				onUpdate: 'CASCADE',
			},
			trial_class_id: {
				type: Sequelize.UUID,
				allowNull: false,
				references: { model: 'trial_classes', key: 'id' },
				onDelete: 'RESTRICT',
				onUpdate: 'CASCADE',
			},
			status: {
				type: Sequelize.ENUM('pending_payment', 'payment_failed', 'confirmed', 'cancelled'),
				allowNull: false,
			},
			cancel_reason: {
				type: Sequelize.ENUM('class_full', 'booking_closed', 'expired'),
				allowNull: true,
			},
			confirmed_at: { type: Sequelize.DATE, allowNull: true },
			created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
			updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
		});

		await queryInterface.sequelize.query(`
			ALTER TABLE bookings
				ADD CONSTRAINT bookings_cancel_reason_iff_cancelled CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL)),
				ADD CONSTRAINT bookings_confirmed_at_iff_confirmed CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
		`);

		await queryInterface.sequelize.query(`
			CREATE UNIQUE INDEX bookings_one_live_per_student_class
				ON bookings (student_id, trial_class_id)
				WHERE status IN ('pending_payment', 'payment_failed', 'confirmed')
		`);
		await queryInterface.addIndex('bookings', ['trial_class_id', 'status'], { name: 'bookings_class_status' });
		await queryInterface.addIndex('bookings', ['status', 'updated_at'], { name: 'bookings_status_updated_at' });

		await queryInterface.sequelize.query(`
			CREATE FUNCTION bookings_maintain_confirmed_count() RETURNS trigger
			LANGUAGE plpgsql AS $$
			BEGIN
				IF TG_OP = 'UPDATE' THEN
					IF NEW.trial_class_id <> OLD.trial_class_id THEN
						RAISE EXCEPTION 'a booking cannot move to another class' USING ERRCODE = 'check_violation';
					END IF;
					IF OLD.status = 'confirmed' AND NEW.status <> 'confirmed' THEN
						UPDATE trial_classes SET confirmed_count = confirmed_count - 1 WHERE id = OLD.trial_class_id;
					ELSIF OLD.status <> 'confirmed' AND NEW.status = 'confirmed' THEN
						UPDATE trial_classes SET confirmed_count = confirmed_count + 1 WHERE id = NEW.trial_class_id;
					END IF;
					RETURN NEW;
				ELSIF TG_OP = 'INSERT' THEN
					IF NEW.status = 'confirmed' THEN
						UPDATE trial_classes SET confirmed_count = confirmed_count + 1 WHERE id = NEW.trial_class_id;
					END IF;
					RETURN NEW;
				ELSE
					IF OLD.status = 'confirmed' THEN
						UPDATE trial_classes SET confirmed_count = confirmed_count - 1 WHERE id = OLD.trial_class_id;
					END IF;
					RETURN OLD;
				END IF;
			END;
			$$
		`);
		await queryInterface.sequelize.query(`
			CREATE TRIGGER bookings_confirmed_count
				AFTER INSERT OR UPDATE OF status, trial_class_id OR DELETE ON bookings
				FOR EACH ROW EXECUTE FUNCTION bookings_maintain_confirmed_count()
		`);
	},

	async down(queryInterface) {
		await queryInterface.dropTable('bookings');
		await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS bookings_maintain_confirmed_count()');
		await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_bookings_status');
		await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_bookings_cancel_reason');
	},
};
