import type { ViewPreset } from '../engine.ts';

// Keyboard shortcuts on the 3D stage. Keys are matched by the character typed; only when that is not
// an ASCII character (Arabic and other non-Latin layouts: F types "ب" there) does the physical key count.

export type StageCommand =
  | { kind: 'zoom'; dir: 1 | -1 }
  | { kind: 'fitAll' }
  | { kind: 'frame' }
  | { kind: 'view'; view: ViewPreset }
  | { kind: 'clear' }
  | { kind: 'help' };

/** Camera presets in the order of their number keys (1 to 4). */
export const VIEW_PRESETS: readonly ViewPreset[] = ['default', 'top', 'front', 'side'];

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);

/** True while the person is typing, so shortcuts leave the keys alone. */
export function isTyping(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(el.type);
}

/** A printable ASCII character typed: the layout already says what the key means. */
const isAscii = (key: string) => key.length === 1 && key.charCodeAt(0) < 0x80;

/** Western, Arabic-Indic and Persian digits typed, else (non-Latin layouts) the digit row pressed. */
function digitOf(e: KeyboardEvent): number | null {
  const ch = e.key.length === 1 ? e.key.charCodeAt(0) : -1;
  if (ch >= 0x30 && ch <= 0x39) return ch - 0x30;
  if (ch >= 0x660 && ch <= 0x669) return ch - 0x660;
  if (ch >= 0x6f0 && ch <= 0x6f9) return ch - 0x6f0;
  const m = isAscii(e.key) ? null : /^Digit(\d)$/.exec(e.code);
  return m ? Number(m[1]) : null;
}

export function stageCommand(e: KeyboardEvent): StageCommand | null {
  const { key, code } = e;
  if (key === 'Escape') return { kind: 'clear' };
  if (key === '+' || key === '=' || code === 'NumpadAdd') return { kind: 'zoom', dir: 1 };
  // "−" is U+2212, the minus sign some layouts type.
  if (key === '-' || key === '_' || key === '−' || code === 'NumpadSubtract') return { kind: 'zoom', dir: -1 };
  // "؟" is the Arabic question mark (Shift and the same key on Arabic layouts).
  if (key === '?' || key === '؟') return { kind: 'help' };
  if (key === 'f' || key === 'F' || (code === 'KeyF' && !isAscii(key))) return { kind: 'frame' };
  const d = digitOf(e);
  if (d === 0) return { kind: 'fitAll' };
  const view = d === null ? undefined : VIEW_PRESETS[d - 1];
  return view ? { kind: 'view', view } : null;
}
