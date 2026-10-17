import { resetDemo } from '#/mock/db.ts';
import { handle } from './core.ts';

/** Demo only: restores the sample families. Has no counterpart in the real API. */
export function resetDemoData(): Promise<void> {
  return handle(() => resetDemo());
}

/** Demo only: notifies when another browser tab changed the demo data. */
export { onExternalChange } from '#/mock/db.ts';
