import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(container) {
  if (!container) return [];
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
    .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

/**
 * Shared modal-dialog behavior: initial focus, Tab containment, Escape close,
 * and restoration to the control that opened the dialog.
 */
export default function useDialogA11y({ open = true, onClose, initialFocusRef, returnFocusRef } = {}) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Isolate the dialog at every ancestor level so pointer, keyboard, and
    // assistive-technology users cannot interact with background controls.
    const isolated = [];
    const appShell = dialog?.closest?.('.pl-app-shell');
    let branch = dialog;
    while (branch?.parentElement && branch !== appShell) {
      const parent = branch.parentElement;
      [...parent.children].forEach((sibling) => {
        if (sibling === branch) return;
        isolated.push({
          element: sibling,
          inert: sibling.inert,
          ariaHidden: sibling.getAttribute('aria-hidden'),
        });
        sibling.inert = true;
        sibling.setAttribute('aria-hidden', 'true');
      });
      branch = parent;
    }
    const initial = initialFocusRef?.current || focusableElements(dialog)[0] || dialog;
    requestAnimationFrame(() => initial?.focus?.());

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableElements(dialog);
      if (items.length === 0) {
        event.preventDefault();
        dialog?.focus?.();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      isolated.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden == null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      requestAnimationFrame(() => {
        const returnTarget = returnFocusRef?.current?.isConnected
          ? returnFocusRef.current
          : previouslyFocused;
        if (returnTarget?.isConnected) returnTarget.focus();
      });
    };
  }, [initialFocusRef, open, returnFocusRef]);

  return dialogRef;
}

export function handleTabArrowKeys(event, activeId, setActiveId) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')]
    .filter((tab) => !tab.disabled);
  if (tabs.length === 0) return;
  event.preventDefault();
  const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.dataset.tabId === activeId));
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  const next = tabs[nextIndex];
  setActiveId(next.dataset.tabId);
  next.focus();
}
