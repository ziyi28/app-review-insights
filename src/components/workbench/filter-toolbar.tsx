import type { Dictionary } from "@/i18n";
import { Icon } from "@/components/ui/icons";
import styles from "./filter-toolbar.module.css";

export type PriorityOption = "all" | "P0" | "P1" | "P2";
export type SufficiencyOption = "all" | "sufficient" | "insufficient" | "conflict";

export interface FilterToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  priorityFilter?: PriorityOption;
  onPriorityChange?: (priority: PriorityOption) => void;
  sufficiencyFilter?: SufficiencyOption;
  onSufficiencyChange?: (sufficiency: SufficiencyOption) => void;
  totalCount: number;
  filteredCount: number;
  t: Dictionary;
}

export function FilterToolbar({
  search,
  onSearchChange,
  priorityFilter,
  onPriorityChange,
  sufficiencyFilter,
  onSufficiencyChange,
  totalCount,
  filteredCount,
  t,
}: FilterToolbarProps) {
  return (
    <div className={styles.toolbar} role="search" aria-label={t.filterSearchPlaceholder}>
      <div className={styles.leftGroup}>
        <div className={styles.searchWrap}>
          <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none", display: "flex" }}>
            <Icon name="search" size={13} />
          </span>
          <input
            type="text"
            className={styles.searchInput}
            style={{ paddingLeft: "30px" }}
            placeholder={t.filterSearchPlaceholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label={t.filterSearchPlaceholder}
          />
          {search ? (
            <button
              type="button"
              className={styles.clearBtn}
              onClick={() => onSearchChange("")}
              aria-label={t.cancel}
            >
              ✕
            </button>
          ) : null}
        </div>

        {onPriorityChange && priorityFilter !== undefined ? (
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>{t.filterPriority}:</span>
            {(["all", "P0", "P1", "P2"] as const).map((p) => {
              const active = priorityFilter === p;
              const pClass = p === "P0" ? styles.pillBtnP0 : p === "P1" ? styles.pillBtnP1 : p === "P2" ? styles.pillBtnP2 : "";
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPriorityChange(p)}
                  className={`${styles.pillBtn} ${pClass} ${active ? styles.pillBtnActive : ""}`}
                >
                  {p === "all" ? t.filterAll : p}
                </button>
              );
            })}
          </div>
        ) : null}

        {onSufficiencyChange && sufficiencyFilter !== undefined ? (
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>{t.filterSufficiency}:</span>
            {(
              [
                { id: "all", label: t.filterAll },
                { id: "sufficient", label: t.evidenceSufficient },
                { id: "insufficient", label: t.evidenceInsufficient },
                { id: "conflict", label: t.conflict },
              ] as const
            ).map((s) => {
              const active = sufficiencyFilter === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSufficiencyChange(s.id)}
                  className={`${styles.pillBtn} ${active ? styles.pillBtnActive : ""}`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className={styles.countBadge}>
        {t.filterResultsCount}: <strong>{filteredCount}</strong> / {totalCount}
      </div>
    </div>
  );
}
