import * as React from 'react';

type AutoFocusHandler = ((event: Event) => void) | undefined;

/**
 * Focus goes back to whatever had it when an overlay opened (WAI-ARIA dialog
 * pattern; REFINE §2.8 "dialogs return focus to their trigger").
 *
 * Radix returns focus to its own `Trigger` only. Most dialogs and sheets in
 * the app are CONTROLLED and have no Trigger (`open={…}` from a row button, a
 * menu item, a keyboard shortcut), so Radix's close handler focused a null
 * ref and dropped focus to <body>: the keyboard user started again from the
 * top of the page. This remembers the element that had focus as the overlay
 * opened — `onOpenAutoFocus` fires before Radix moves focus inside — and puts
 * focus back there on close.
 *
 * The caller's own handlers still run, first: a caller that calls
 * `event.preventDefault()` in `onCloseAutoFocus` and moves focus itself
 * ("Go to Vitals") keeps control. If the remembered element has left the
 * document (a closed menu's item), Radix's default runs as before.
 */
export function useReturnFocus(onOpenAutoFocus: AutoFocusHandler, onCloseAutoFocus: AutoFocusHandler) {
  const returnTo = React.useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event: Event) => {
      const active = document.activeElement;
      returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      const target = returnTo.current;
      returnTo.current = null;
      if (event.defaultPrevented || !target?.isConnected) return;
      event.preventDefault();
      target.focus();
    },
  };
}
