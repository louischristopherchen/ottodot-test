import type { StudentDto } from '@trial-booking/shared';

import { Student } from '../../models/index.js';

class StudentsService {
	async listForParent(parentId: string): Promise<StudentDto[]> {
		const students = await Student.findAll({ where: { parentId }, order: [['name', 'ASC']] });
		return students.map((student) => ({ id: student.id, name: student.name, level: student.level }));
	}
}

export const studentsService = new StudentsService();
