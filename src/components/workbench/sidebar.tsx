"use client";

import type { Dictionary } from "@/i18n";
import { Icon, type IconName } from "@/components/ui/icons";
import styles from "./sidebar.module.css";

export type TabId =
  | "overview"
  | "raw"
  | "cleaned"
  | "classification"
  | "topics"
  | "findings"
  | "evidence"
  | "versions"
  | "prd"
  | "tests"
  | "traceability"
  | "deliverables"
  | "diagnostics";

export type ViewMode = "workbench" | "report";

export interface NavGroup {
  id: string;
  labelKey: keyof Dictionary;
  items: {
    id: TabId;
    labelKey: keyof Dictionary;
    icon: IconName;
  }[];
}

export const SIDEBAR_NAV_GROUPS: NavGroup[] = [
  {
    id: "data",
    labelKey: "groupData",
    items: [
      { id: "overview", labelKey: "overview", icon: "overview" },
      { id: "cleaned", labelKey: "cleanedData", icon: "data" },
      { id: "raw", labelKey: "rawReviews", icon: "table" },
    ],
  },
  {
    id: "analysis",
    labelKey: "groupEvidence",
    items: [
      { id: "classification", labelKey: "classification", icon: "layers" },
      { id: "topics", labelKey: "topics", icon: "topics" },
      { id: "findings", labelKey: "findings", icon: "findings" },
    ],
  },
  {
    id: "product",
    labelKey: "groupProduct",
    items: [
      { id: "versions", labelKey: "versionPlan", icon: "versions" },
      { id: "prd", labelKey: "prd", icon: "prd" },
      { id: "tests", labelKey: "testCases", icon: "tests" },
    ],
  },
  {
    id: "quality",
    labelKey: "traceability",
    items: [
      { id: "evidence", labelKey: "evidenceValidation", icon: "check" },
      { id: "traceability", labelKey: "traceability", icon: "traceability" },
      { id: "deliverables", labelKey: "finalDeliverables", icon: "deliverables" },
      { id: "diagnostics", labelKey: "runLog", icon: "diagnostics" },
    ],
  },
];

export interface SidebarProps {
  activeTab: TabId;
  onSelectTab: (id: TabId) => void;
  viewMode?: ViewMode;
  onSelectViewMode?: (mode: ViewMode) => void;
  t: Dictionary;
  onUserNavigate?: () => void;
}

export function Sidebar({
  activeTab,
  onSelectTab,
  viewMode = "workbench",
  onSelectViewMode,
  t,
  onUserNavigate,
}: SidebarProps) {
  const handleTabClick = (id: TabId) => {
    if (viewMode === "report") {
      onSelectViewMode?.("workbench");
    }
    onSelectTab(id);
    onUserNavigate?.();
  };

  return (
    <aside className={styles.sidebar} aria-label={t.appTitle}>
      <nav className={styles.navSection}>
        {SIDEBAR_NAV_GROUPS.map((group) => (
          <div key={group.id} className={styles.group}>
            <div className={styles.groupLabel}>{t[group.labelKey]}</div>
            {group.items.map((item) => {
              const isActive = viewMode === "workbench" && activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  id={`tab-${item.id}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`panel-${item.id}`}
                  className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
                  onClick={() => handleTabClick(item.id)}
                >
                  <span className={styles.navItemIcon}>
                    <Icon name={item.icon} size={15} />
                  </span>
                  <span className={styles.navItemLabel}>{t[item.labelKey]}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
