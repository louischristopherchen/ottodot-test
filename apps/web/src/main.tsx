import './styles/globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { restoreSession } from './services/api';

// Outside React so StrictMode's double effects cannot spend the rotating refresh cookie twice.
void restoreSession();

const container = document.getElementById('root');
if (!container) {
	throw new Error('Missing #root element in index.html');
}

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
