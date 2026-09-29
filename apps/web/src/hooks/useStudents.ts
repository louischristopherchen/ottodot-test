import { useQuery } from '@tanstack/react-query';

import { api } from '@/services/api';
import { queryKeys } from '@/services/keys';

export function useStudents() {
	return useQuery({
		queryKey: queryKeys.students,
		queryFn: ({ signal }) => api.listStudents(signal),
	});
}
