import { useToast } from '../hooks/use-toast';
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from './toast';

/** Mount once near the root. Renders every toast queued with `toast()`. */
function Toaster() {
	const { toasts, dismiss } = useToast();
	return (
		<ToastProvider swipeDirection="right">
			{toasts.map((item) => (
				<Toast
					key={item.id}
					variant={item.variant}
					open={item.open}
					onOpenChange={(open) => {
						if (!open) {
							dismiss(item.id);
						}
					}}
				>
					<div className="grid gap-1">
						<ToastTitle>{item.title}</ToastTitle>
						{item.description ? <ToastDescription>{item.description}</ToastDescription> : null}
					</div>
					<ToastClose />
				</Toast>
			))}
			<ToastViewport />
		</ToastProvider>
	);
}

export { Toaster };
