import type React from 'react';

/**
 * Makes a non-button element (a game tile, a card, a table row) usable from the
 * keyboard: it joins the Tab order, is announced as a button, and Enter or
 * Space activates it, the same as a click. Spread it onto the element next to
 * its onClick:
 *
 *   <div onClick={go} {...pressable(go, 'Open basket')}>
 *
 * Prefer a real <button type="button"> where it doesn't upset the layout.
 */
export function pressable(onActivate: () => void, label?: string, disabled = false) {
  return {
    role: 'button' as const,
    tabIndex: disabled ? -1 : 0,
    'aria-disabled': disabled || undefined,
    'aria-label': label,
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (disabled || e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        onActivate();
      }
    },
  };
}
