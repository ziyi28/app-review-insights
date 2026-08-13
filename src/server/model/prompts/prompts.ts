import type { PromptRegistry as PromptRegistryType } from "./registry";
import { scopePrompt } from "./scope.v1";
import { topicDiscoveryPrompt, topicConsolidationPrompt } from "./topics.v2";
import { findingsPrompt } from "./findings.v2";
import { findingsConsolidationPrompt } from "./findings-consolidation.v1";
import { planningPrompt } from "./planning.v2";
import { coverageRepairPrompt } from "./coverage-repair.v1";
import { testsPrompt } from "./tests.v1";
import { revisionPrompt } from "./revision.v1";

export const PromptRegistry: PromptRegistryType = {
  [scopePrompt.id]: scopePrompt,
  [topicDiscoveryPrompt.id]: topicDiscoveryPrompt,
  [topicConsolidationPrompt.id]: topicConsolidationPrompt,
  [findingsPrompt.id]: findingsPrompt,
  [findingsConsolidationPrompt.id]: findingsConsolidationPrompt,
  [planningPrompt.id]: planningPrompt,
  [coverageRepairPrompt.id]: coverageRepairPrompt,
  [testsPrompt.id]: testsPrompt,
  [revisionPrompt.id]: revisionPrompt,
};

export * from "./scope.v1";
export * from "./topics.v2";
export * from "./findings.v2";
export * from "./findings-consolidation.v1";
export * from "./planning.v2";
export * from "./coverage-repair.v1";
export * from "./tests.v1";
export * from "./revision.v1";
