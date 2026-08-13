"use client";

import { useRef } from "react";
import styles from "./tab-list.module.css";

export type TabItem = { id: string; label: string };

export type TabListProps = {
  tabs: TabItem[];
  active: string;
  onSelect: (id: string) => void;
  /** Called whenever the user manually activates a tab (stops auto-advance). */
  onUserNavigate?: () => void;
  /** Accessible name for the tablist. */
  label: string;
};

/**
 * Single-row, horizontally scrollable tablist with proper WAI-ARIA tab
 * semantics (role=tablist/tab, aria-selected, aria-controls) and keyboard
 * support: ArrowLeft/Right cycle, Home/End jump to the first/last tab. The
 * active tab is scrolled into view whenever it changes (auto-advance included).
 */
export function TabList({ tabs, active, onSelect, onUserNavigate, label }: TabListProps) {
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const scrollTab = (id: string) => {
    const el = refs.current.get(id);
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };

  const focusTab = (id: string) => {
    const el = refs.current.get(id);
    el?.focus();
    scrollTab(id);
  };

  const activate = (id: string) => {
    onUserNavigate?.();
    onSelect(id);
    // Scroll after React re-renders the active state.
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: () => void) => cb();
    raf(() => scrollTab(id));
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    const idx = tabs.findIndex((tab) => tab.id === id);
    if (idx === -1) return;
    let next: string | null = null;
    switch (e.key) {
      case "ArrowRight":
        next = tabs[(idx + 1) % tabs.length].id;
        break;
      case "ArrowLeft":
        next = tabs[(idx - 1 + tabs.length) % tabs.length].id;
        break;
      case "Home":
        next = tabs[0].id;
        break;
      case "End":
        next = tabs[tabs.length - 1].id;
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        activate(id);
        return;
      default:
        return;
    }
    e.preventDefault();
    if (next) {
      onSelect(next);
      focusTab(next);
    }
  };

  return (
    <div role="tablist" aria-label={label} className={styles.tablist} aria-orientation="horizontal">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) refs.current.set(tab.id, el);
              else refs.current.delete(tab.id);
            }}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => activate(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, tab.id)}
            className={selected ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
