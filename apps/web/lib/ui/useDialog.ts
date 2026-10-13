'use client';

import { RefObject, useEffect, useRef } from 'react';

// One behaviour for every modal surface: focus moves in on open, Tab stays inside, Escape closes
// only the topmost dialog, focus returns to the opener, and the page behind does not scroll.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const openDialogs: HTMLElement[] = [];
let scrollLocks = 0;
let previousOverflow = '';

function focusableIn(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getClientRects().length > 0
  );
}

export function useDialog(
  ref: RefObject<HTMLElement>,
  onClose: () => void,
  active: boolean = true
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openDialogs.push(node);

    if (scrollLocks === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    scrollLocks += 1;

    const focusFirst = () => {
      if (node.contains(document.activeElement)) return;
      const preferred = node.querySelector<HTMLElement>('[data-autofocus]');
      const target = preferred || focusableIn(node)[0] || node;
      if (target === node && !node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    };
    // The dialog is mounted when effects run; focus now (rAF would never fire in a hidden tab).
    focusFirst();

    const onKeyDown = (e: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== node) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusableIn(node);
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (!current || !node.contains(current)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (current === first || current === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const idx = openDialogs.lastIndexOf(node);
      if (idx !== -1) openDialogs.splice(idx, 1);
      scrollLocks = Math.max(0, scrollLocks - 1);
      if (scrollLocks === 0) document.body.style.overflow = previousOverflow;
      if (opener && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [active, ref]);
}
