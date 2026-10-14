// Site-wide loading state for buttons.
//
// Any backend request started by a button click marks that button busy
// (data-busy / aria-busy) until the request settles; globals.css draws a
// spinner for it. This covers every <button> without each one wiring its own
// loading state. Buttons that already render their own spinner (.animate-spin)
// are left alone by the CSS.
//
// Attribution: a capture-phase click listener remembers the clicked button for
// a short window, and apiFetch hands its promise to trackBusy(). Requests made
// outside that window (polling, page loads) are not attributed to any button.

const CLICK_WINDOW_MS = 300;
const BUTTON_SELECTOR = 'button, [role="button"], a.ds-btn';

let clicked: HTMLElement | null = null;
let clearTimer: ReturnType<typeof setTimeout> | undefined;
let installed = false;
const pending = new WeakMap<HTMLElement, number>();

function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest?.(BUTTON_SELECTOR) as HTMLElement | null;
      if (!el) return;
      clicked = el;
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        if (clicked === el) clicked = null;
      }, CLICK_WINDOW_MS);
    },
    true
  );
}

function setBusy(el: HTMLElement, delta: number) {
  const n = (pending.get(el) ?? 0) + delta;
  if (n > 0) {
    pending.set(el, n);
    el.setAttribute('data-busy', '');
    el.setAttribute('aria-busy', 'true');
  } else {
    pending.delete(el);
    el.removeAttribute('data-busy');
    el.removeAttribute('aria-busy');
  }
}

/** Show the clicked button (if any) as loading until `promise` settles. */
export function trackBusy<T>(promise: Promise<T>): Promise<T> {
  install();
  const el = clicked;
  if (!el) return promise;
  setBusy(el, 1);
  const done = () => setBusy(el, -1);
  promise.then(done, done);
  return promise;
}

// Start listening as soon as this module loads in the browser, so the very
// first click is seen.
install();
