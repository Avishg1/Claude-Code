import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { logError } from './utils/logger';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container, {
  // Errors React recovers from on its own are otherwise only reported in development.
  onRecoverableError: (error) => logError(error, { kind: 'recoverable' }),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Errors outside React rendering (event handlers, async code) end up here.
window.addEventListener('unhandledrejection', (e) => logError(e.reason, { kind: 'unhandledrejection' }));
