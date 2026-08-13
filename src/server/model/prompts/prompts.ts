import type { PromptRegistry as PromptRegistryType } from "./registry";
import { scopePrompt } from "./scope.v1";
import { topicDiscoveryPrompt, topicConsolidationPrompt } from "./topics.v1";
import { findingsPrompt } from "./findings.v1";
import { planningPrompt } from "./planning.v2";
import { testsPrompt } from "./tests.v1";
import { revisionPrompt } from "./revision.v1";

export const PromptRegistry: PromptRegistryType = {
  [scopePrompt.id]: scopePrompt,
  [topicDiscoveryPrompt.id]: topicDiscoveryPrompt,
  [topicConsolidationPrompt.id]: topicConsolidationPrompt,
  [findingsPrompt.id]: findingsPrompt,
  [planningPrompt.id]: planningPrompt,
  [testsPrompt.id]: testsPrompt,
  [revisionPrompt.id]: revisionPrompt,
};

export * from "./scope.v1";
export * from "./topics.v1";
export * from "./findings.v1";
export * from "./planning.v2";
export * from "./tests.v1";
export * from "./revision.v1";
