/*
 * instrumentation-client.ts
 *
 * Runs in the browser before the app becomes interactive. Reports errors
 * nothing else caught — a script that threw, a promise nobody handled — to
 * the platform's error log (ROADMAP 13.3). Errors an error boundary catches
 * are reported by the boundary (components/layout/route-error.tsx).
 */
import { reportClientError } from './lib/ops/client-report';

window.addEventListener('error', (event) => reportClientError(event.error ?? event.message, 'browser'));
window.addEventListener('unhandledrejection', (event) => reportClientError(event.reason, 'rejection'));
