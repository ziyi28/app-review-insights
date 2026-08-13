"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared modal behavior for the History and Settings dialogs:
 *   - moves initial focus into the dialog on open,
 *   - traps Tab / Shift+Tab within the dialog,
 *   - closes on Escape,
 *   - restores focus to the previously focused element on close.
 *
 * The host passes `containerRef` on the dialog element and calls the returned
 * `onKeyDown` from the dialog container (or any descendant) to handle Escape
 * and the focus trap. Overlay click-to-close stays the host's responsibility.
 */
export function useModal(open: boolean, onClose: () => void, containerRef: React.RefObject<HTMLDivElement | null>) {
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    // Initial focus: first focusable element in the dialog.
    const container = containerRef.current;
    if (container) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }
    return () => {
      restoreRef.current?.focus?.();
    };
  }, [open, containerRef]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const container = containerRef.current;
    if (!container) return;
    const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !container.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  };

  return { onKeyDown };
}
