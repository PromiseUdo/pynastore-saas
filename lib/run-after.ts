/*
 * lib/run-after.ts
 *
 * Work to do once the response has gone — an email, a push — without making
 * the person wait for it. Inside a request this is Next's `after()`.
 *
 * Outside one (a script, a test) `after()` throws, so instead:
 *   - under vitest the task is queued, and a test that cares runs it with
 *     flushAfterTasks(); one that doesn't never sends an email by accident;
 *   - anywhere else it simply runs, without being awaited.
 *
 * A task's failure is logged, never thrown: nothing done "after" may undo
 * what was already answered.
 */
import { after } from 'next/server';

type Task = () => Promise<unknown>;

const queued: Task[] = [];

function guarded(task: Task): Task {
  return async () => {
    try {
      await task();
    } catch (error) {
      console.error('[after] A follow-up task failed:', error);
    }
  };
}

export function runAfter(task: Task): void {
  const safe = guarded(task);
  try {
    after(safe);
    return;
  } catch {
    // Not inside a request.
  }
  if (process.env.VITEST) queued.push(safe);
  else void safe();
}

/** Tests: run what runAfter queued outside a request, in order, and wait for it. */
export async function flushAfterTasks(): Promise<void> {
  while (queued.length) await queued.shift()!();
}

/** Tests: forget anything queued by earlier tests. */
export function discardAfterTasks(): void {
  queued.length = 0;
}
