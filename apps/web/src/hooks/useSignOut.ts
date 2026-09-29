import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { api } from '@/services/api';

export function useSignOut() {
	const navigate = useNavigate();
	return useMutation({
		mutationFn: () => api.logout(),
		onSettled: () => {
			void navigate('/login', { replace: true });
		},
	});
}
