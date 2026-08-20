export type Locale = "en" | "zh-CN";

export type Dictionary = {
  appTitle: string;
  newRun: string;
  liveMode: string;
  importMode: string;
  appStoreUrl: string;
  reviewLimit: string;
  reviewLimitHint: string;
  goal: string;
  outputLocale: string;
  start: string;
  uiLanguage: string;
  modelStatus: string;
  modelConfigured: string;
  modelNotConfigured: string;
  modelStatusLoading: string;
  overview: string;
  rawReviews: string;
  cleanedData: string;
  topics: string;
  findings: string;
  versionPlan: string;
  prd: string;
  testCases: string;
  traceability: string;
  stageScope: string;
  stageSource: string;
  stagePrepare: string;
  stageTopics: string;
  stageFindings: string;
  stageEvidenceValidation: string;
  stagePlanning: string;
  stageRequirementEvidence: string;
  stageTests: string;
  stageTraceability: string;
  stageRevision: string;
  waiting: string;
  starting: string;
  running: string;
  completed: string;
  stageSkipped: string;
  interrupted: string;
  reconnecting: string;
  goalTooShort: string;
  invalidAppStoreUrl: string;
  goalCharCount: string;
  history: string;
  historyEmpty: string;
  historyLoadFailed: string;
  view: string;
  replay: string;
  failed: string;
  errors: string;
  limitations: string;
  assumptions: string;
  confidence: string;
  supportCount: string;
  aiGenerated: string;
  computed: string;
  source: string;
  conflict: string;
  importFile: string;
  cachedReplay: string;
  sourceLive: string;
  sourceImported: string;
  sourcePartial: string;
  sourceSuspectEmpty: string;
  eventLog: string;
  showEvents: string;
  hideEvents: string;
  reviewId: string;
  rating: string;
  version: string;
  language: string;
  ratingDistribution: string;
  versionDistribution: string;
  languageDistribution: string;
  status: string;
  body: string;
  title: string;
  noData: string;
  duplicates: string;
  identityConflicts: string;
  uncertain: string;
  expected: string;
  normalized: string;
  sourceId: string;
  replaySource: string;
  settings: string;
  modelBaseUrl: string;
  modelApiKey: string;
  modelName: string;
  modelJsonMode: string;
  modelReasoningEffort: string;
  modelReasoningEffortHint: string;
  save: string;
  saved: string;
  close: string;
  apiKeyConfigured: string;
  apiKeyPlaceholder: string;
  apiKeyClear: string;
  configApplyError: string;
  dataSourceSettings: string;
  serpApiKey: string;
  serpApiKeyHint: string;
  serpApiKeyConfigured: string;
  serpApiKeyClear: string;
  checkingSample: string;
  sampleCheckFailed: string;
  liveSample: string;
  stableSample: string;
  recommended: string;
  liveReviews: string;
  stableReviews: string;
  cacheUpdated: string;
  sourceLiveCache: string;
  noSampleAvailable: string;
  recheck: string;
  useImportInstead: string;
  notChecked: string;
  evidenceStrength: string;
  evidenceSufficient: string;
  evidenceInsufficient: string;
  supportRatio: string;
  freshReviews: string;
  localHistoryReviews: string;
  serpApiFresh: string;
  appleRssFallback: string;
  searchesUsed: string;
  analyzeFresh: string;
  analyzeHistory: string;
  freshnessCaveat: string;
  sourceSerpApi: string;
  sourceSerpApiHistory: string;
  sourceRssFallback: string;
  sourceRssHistory: string;
  requirementId: string;
  findingId: string;
  priority: string;
  precondition: string;
  classification: string;
  evidenceValidation: string;
  finalDeliverables: string;
  draft: string;
  final: string;
  noRevisionRequired: string;
  legacyArtifactUnavailable: string;
  versionRationale: string;
  factorSeverity: string;
  factorEvidenceStrength: string;
  factorConfidence: string;
  factorUserImpact: string;
  factorFrequency: string;
  factorImplementationScope: string;
  factorDependency: string;
  logicalCalls: string;
  modelAttempts: string;
  modelRetries: string;
  modelRetryReasons: string;
  promptVersions: string;
  diagnosticsError: string;
  diagnosticsWarning: string;
  diagnosticsValidation: string;
  diagnosticsRevision: string;
  stageBatch: string;
  cleaningUnicode: string;
  cleaningWhitespace: string;
  cleaningCaseFolded: string;
  cleaningLanguages: string;
  cleaningExactDuplicates: string;
  cleaningIdentityConflicts: string;
  cleaningShortKept: string;
  goalCoverage: string;
  goalCoverageCovered: string;
  goalCoverageUncovered: string;
  goalCoverageUnsupported: string;
  goalCoverageGap: string;
  wizardStepSource: string;
  wizardStepConfigure: string;
  wizardStepConfirm: string;
  liveModeDesc: string;
  importModeDesc: string;
  useExampleApp: string;
  back: string;
  next: string;
  confirmFile: string;
  collectionStatus: string;
  collectionConfigured: string;
  runLog: string;
  eventCount: string;
  filterByStage: string;
  filterByEventType: string;
  all: string;
  sequence: string;
  stage: string;
  type: string;
  message: string;
  retry: string;
  retrying: string;
  runFailed: string;
  openInAppStore: string;
  importedFile: string;
  delete: string;
  deleteConfirm: string;
  cancel: string;
  deleteFailed: string;
  viewModeReport: string;
  viewModeWorkbench: string;
  groupProduct: string;
  groupEvidence: string;
  groupData: string;
  filterAll: string;
  filterSearchPlaceholder: string;
  filterPriority: string;
  filterSufficiency: string;
  filterResultsCount: string;
  copyMarkdownReport: string;
  copied: string;
  copyFailed: string;
  printReport: string;
  userQuote: string;
  confidenceLevel: string;
  acceptanceCriteria: string;
  acceptanceCriteriaProvenance: string;
  executiveSummary: string;

  keyFindings: string;
  roadmapMilestones: string;
  requirementsSpecs: string;
  verificationPlan: string;
  noFilteredResults: string;
  exportPackage: string;
  downloadCsvTemplate: string;
    topFindings: string;
    appSummary: string;
    dataCleaningDetails: string;
    traceMatrixTitle: string;
    traceMatrixSubtitle: string;
    traceColFinding: string;
    traceColReviews: string;
    traceColRequirement: string;
    traceColTests: string;
    traceStatusClosed: string;
    traceStatusViolation: string;
    traceStatusMissingTest: string;
    traceStatusUncovered: string;
    jumpToReview: string;
    viewTestCases: string;
    viewPrdRequirement: string;
    traceValidationSummary: string;
    traceRevisedPassed: string;
    traceCoverageLabel: string;
    traceCoverageFindings: string;
    traceCoverageRequirements: string;
    finalDeliverablesSubtitle: string;
    exportPackageTitle: string;
    appNameLabel: string;
    appStoreLinkLabel: string;
    versionLabel: string;
    includedRequirements: string;
    supportingReviewIdsLabel: string;
    exportCorrespondsTo: string;
    noneValue: string;
    testSteps: string;
    tableOfContents: string;
    clearSearch: string;
    copyFullId: string;
    runNotFound: string;
    traceClosureClosed: string;
    traceClosurePartial: string;
    traceClosureAssumptionOnly: string;
    traceClosureInvalid: string;
    traceStatusAssumption: string;
    noSchedulableRequirements: string;
    structuralValidation: string;
    productClosure: string;
    sourceFindings: string;
    sourceReviews: string;
};

export const dictionaries: Record<Locale, Dictionary> = {
  en: {
    appTitle: "App Review Planner",
    newRun: "New Run",
    liveMode: "Live",
    importMode: "Import",
    appStoreUrl: "App Store URL (reviews use the US storefront)",
    reviewLimit: "Review count",
    reviewLimitHint: "More reviews take longer to analyze.",
    goal: "Analysis goal",
    outputLocale: "Output language",
    start: "Start",
    uiLanguage: "Language",
    modelStatus: "Model",
    modelConfigured: "Configured",
    modelNotConfigured: "Not configured",
    modelStatusLoading: "Checking…",
    overview: "Overview",
    rawReviews: "Raw Reviews",
    cleanedData: "Cleaned Data",
    topics: "Topics",
    findings: "Findings",
    versionPlan: "Version Plan",
    prd: "PRD",
    testCases: "Test Cases",
    traceability: "Traceability",
    stageScope: "Scope",
    stageSource: "Source",
    stagePrepare: "Prepare",
    stageTopics: "Topics",
    stageFindings: "Findings",
    stageEvidenceValidation: "Evidence Validation",
    stagePlanning: "Planning",
    stageRequirementEvidence: "Requirement Evidence",
    stageTests: "Tests",
    stageTraceability: "Traceability",
    stageRevision: "Revision",
    waiting: "Enter a URL or import reviews to begin.",
    starting: "Starting analysis…",
    running: "Analysis running…",
    interrupted: "Interrupted",
    reconnecting: "Reconnecting…",
    goalTooShort: "Analysis goal must be at least 10 characters.",
    invalidAppStoreUrl: "Please enter a valid Apple App Store URL (e.g. https://apps.apple.com/us/app/.../id123456789)",
    goalCharCount: "characters (min 10)",
    history: "History",
    historyEmpty: "No past runs yet.",
    historyLoadFailed: "Failed to load history.",
    view: "View",
    replay: "Replay",
    completed: "Completed",
    stageSkipped: "Skipped",
    failed: "Failed",
    errors: "errors",
    limitations: "Limitations",
    assumptions: "Assumptions",
    confidence: "Confidence",
    supportCount: "Supporting reviews",
    aiGenerated: "AI-generated",
    computed: "Computed",
    source: "Source",
    conflict: "Conflict",
    importFile: "Import JSON or CSV",
    cachedReplay: "Cached Replay",
    sourceLive: "Live",
    sourceImported: "Imported",
    sourcePartial: "Partial",
    sourceSuspectEmpty: "Suspect Empty",
    eventLog: "Event Log",
    showEvents: "Show events",
    hideEvents: "Hide events",
    reviewId: "Review ID",
    rating: "Rating",
    version: "Version",
    language: "Language",
    ratingDistribution: "Rating distribution",
    versionDistribution: "Version distribution",
    languageDistribution: "Language distribution",
    status: "Status",
    body: "Body",
    title: "Title",
    noData: "No data yet.",
    duplicates: "Duplicates",
    identityConflicts: "Identity conflicts",
    uncertain: "uncertain",
    expected: "expected",
    normalized: "normalized",
    sourceId: "source id",
    replaySource: "Cached Replay",
    settings: "Settings",
    modelBaseUrl: "API Base URL",
    modelApiKey: "API Key",
    modelName: "Model Name",
    modelJsonMode: "JSON Mode",
    modelReasoningEffort: "Reasoning Effort",
    modelReasoningEffortHint: "Higher effort takes longer per call and may improve output quality.",
    save: "Save",
    saved: "Saved",
    close: "Close",
    apiKeyConfigured: "Configured",
    apiKeyPlaceholder: "Enter a new key to replace the current one",
    apiKeyClear: "Clear key",
    configApplyError: "Failed to save settings",
    dataSourceSettings: "Data collection platform",
    serpApiKey: "SerpApi API Key",
    serpApiKeyHint: "Stored locally and used only by the server for forced-fresh live App Store reviews.",
    serpApiKeyConfigured: "SerpApi configured",
    serpApiKeyClear: "Clear SerpApi Key",
    checkingSample: "Checking review sample…",
    sampleCheckFailed: "Could not check the review sample.",
    liveSample: "Live sample",
    stableSample: "Stable sample",
    recommended: "Recommended",
    liveReviews: "Live reviews",
    stableReviews: "Stable reviews",
    cacheUpdated: "Cache updated",
    sourceLiveCache: "Live + Cache",
    noSampleAvailable: "No reviews available right now — re-check or import a dataset.",
    recheck: "Re-check",
    useImportInstead: "Use Import instead",
    notChecked: "Not yet checked",
    evidenceStrength: "Evidence strength",
    evidenceSufficient: "Sufficient Evidence",
    evidenceInsufficient: "Insufficient Evidence",
    supportRatio: "support ratio",
    freshReviews: "fresh reviews",
    localHistoryReviews: "local-history reviews",
    serpApiFresh: "SerpApi · forced fresh",
    appleRssFallback: "Apple RSS fallback",
    searchesUsed: "SerpApi searches",
    analyzeFresh: "Analyze fresh sample",
    analyzeHistory: "Analyze local history",
    freshnessCaveat: "Fresh fetch requested; App Store publication may still be delayed.",
    sourceSerpApi: "SerpApi / US App Store",
    sourceSerpApiHistory: "SerpApi / US App Store · Local history",
    sourceRssFallback: "Apple RSS fallback / US App Store",
    sourceRssHistory: "Apple RSS fallback / US App Store · Local history",
    requirementId: "Requirement",
    findingId: "Finding",
    priority: "Priority",
    precondition: "Precondition",
    classification: "Classification",
    evidenceValidation: "Evidence Validation",
    finalDeliverables: "Final Deliverables",
    draft: "Draft",
    final: "Final",
    noRevisionRequired: "Final · no revision required",
    legacyArtifactUnavailable: "Not available in this cached run",
    versionRationale: "Version rationale",
    factorSeverity: "Severity",
    factorEvidenceStrength: "Evidence Strength",
    factorConfidence: "Confidence",
    factorUserImpact: "User Impact",
    factorFrequency: "Frequency",
    factorImplementationScope: "Implementation Scope",
    factorDependency: "Dependency",
    logicalCalls: "Logical calls",
    modelAttempts: "HTTP attempts",
    modelRetries: "Retries",
    modelRetryReasons: "Retry reasons",
    promptVersions: "Prompt versions",
    diagnosticsError: "Errors",
    diagnosticsWarning: "Warnings",
    diagnosticsValidation: "Validation",
    diagnosticsRevision: "Revision",
    stageBatch: "batch",
    cleaningUnicode: "Unicode normalized",
    cleaningWhitespace: "whitespace collapsed",
    cleaningCaseFolded: "case folded",
    cleaningLanguages: "Language labels",
    cleaningExactDuplicates: "exact duplicates removed",
    cleaningIdentityConflicts: "identity conflicts",
    cleaningShortKept: "short unique reviews kept",
    goalCoverage: "Goal Coverage",
    goalCoverageCovered: "Covered",
    goalCoverageUncovered: "Uncovered",
    goalCoverageUnsupported: "Unsupported",
    goalCoverageGap: "Coverage gap",
    wizardStepSource: "Choose a source",
    wizardStepConfigure: "Configure input",
    wizardStepConfirm: "Confirm & start",
    liveModeDesc: "Collect fresh US App Store reviews (SerpApi with Apple RSS fallback)",
    importModeDesc: "Import a local JSON or CSV review file — no live collection",
    useExampleApp: "Use example app",
    back: "Back",
    next: "Next",
    confirmFile: "File",
    collectionStatus: "Collection",
    collectionConfigured: "SerpApi / Apple RSS fallback",
    runLog: "Run Log",
    eventCount: "Event count",
    filterByStage: "Filter by stage",
    filterByEventType: "Filter by type",
    all: "All",
    sequence: "Seq",
    stage: "Stage",
    type: "Type",
    message: "Message",
    retry: "Retry",
    retrying: "Retrying…",
    runFailed: "Analysis failed",
    openInAppStore: "Open in App Store",
    importedFile: "File",
    delete: "Delete",
    deleteConfirm: "Delete this run? This cannot be undone.",
    cancel: "Cancel",
    deleteFailed: "Failed to delete the run.",
    viewModeReport: "Executive Report",
    viewModeWorkbench: "Workspace",
    groupProduct: "Product Specs",
    groupEvidence: "Evidence & Trace",
    groupData: "Data & Logs",
    filterAll: "All",
    filterSearchPlaceholder: "Search keywords or ID...",
    filterPriority: "Priority",
    filterSufficiency: "Evidence",
    filterResultsCount: "Showing",
    copyMarkdownReport: "Copy Markdown Report",
    copied: "Copied to clipboard",
    copyFailed: "Failed to copy",
    printReport: "Print / PDF",
    userQuote: "User Quote",
    confidenceLevel: "Confidence",
    acceptanceCriteria: "Acceptance Criteria",
    acceptanceCriteriaProvenance: "AI-suggested targets (not deterministic review statistics)",
    executiveSummary: "Executive Summary",

    keyFindings: "Key Findings & Insights",
    roadmapMilestones: "Version Roadmap & Milestones",
    requirementsSpecs: "PRD Requirements Specifications",
    verificationPlan: "Test & Verification Plan",
    noFilteredResults: "No matching items found.",
    exportPackage: "Export Full Package (Markdown)",
    downloadCsvTemplate: "Download Sample CSV Template",
    topFindings: "Top User Findings & Pain Points",
    appSummary: "App Overview",
    dataCleaningDetails: "Data Cleaning & Quality Details",
    traceMatrixTitle: "End-to-End Traceability Matrix",
    traceMatrixSubtitle: "Full mapping from review evidence to test cases",
    traceColFinding: "Finding",
    traceColReviews: "Reviews",
    traceColRequirement: "Requirement",
    traceColTests: "Test Cases",
    traceStatusClosed: "Closed",
    traceStatusViolation: "Violations",
    traceStatusMissingTest: "No test",
    traceStatusUncovered: "Uncovered",
    jumpToReview: "Jump to review",
    viewTestCases: "View test cases",
    viewPrdRequirement: "View in PRD",
    traceValidationSummary: "end-to-end evidence and requirement validation",
    traceRevisedPassed: "Initial validation failed ({count}) → auto-revised & passed",
    traceCoverageLabel: "Coverage",
    traceCoverageFindings: "findings",
    traceCoverageRequirements: "requirements",
    finalDeliverablesSubtitle: "Version plan, PRD specs, test cases and end-to-end traceability",
    exportPackageTitle: "App Review Analysis & Product Plan — Full Deliverables",
    appNameLabel: "App name",
    appStoreLinkLabel: "App Store link",
    versionLabel: "Version",
    includedRequirements: "Included requirements",
    supportingReviewIdsLabel: "Supporting review IDs",
    exportCorrespondsTo: "covers",
    noneValue: "none",
    testSteps: "Test steps",
    tableOfContents: "Contents",
    clearSearch: "Clear search",
    copyFullId: "Click to copy the full ID",
    fullId: "Full ID",
    importFormatHint: "Supports a JSON array or CSV format. Required fields:",
    orWord: "or",
    runNotFound: "Run not found or deleted.",
    traceClosureClosed: "Closed",
    traceClosurePartial: "Formal chain valid; {count} assumption(s) to verify",
    traceClosureAssumptionOnly: "Insufficient evidence; no product plan produced",
    traceClosureInvalid: "Traceability validation failed",
    traceStatusAssumption: "Assumption to verify",
    noSchedulableRequirements: "No requirements met the evidence threshold for scheduling.",
    structuralValidation: "Structural validation",
    productClosure: "Product closure",
    sourceFindings: "Source findings",
    sourceReviews: "Source reviews",
  },
  "zh-CN": {
    appTitle: "App 评论分析台",
    newRun: "新建运行",
    liveMode: "实时采集",
    importMode: "导入",
    appStoreUrl: "App Store 链接（评论统一使用美国区）",
    reviewLimit: "评论数量",
    reviewLimitHint: "数量越多，分析时间越长。",
    goal: "分析目标",
    outputLocale: "输出语言",
    start: "开始分析",
    uiLanguage: "界面语言",
    modelStatus: "模型",
    modelConfigured: "已配置",
    modelNotConfigured: "未配置",
    modelStatusLoading: "检查中…",
    overview: "概览",
    rawReviews: "原始评论",
    cleanedData: "清洗数据",
    topics: "主题",
    findings: "发现",
    versionPlan: "版本计划",
    prd: "PRD",
    testCases: "测试用例",
    traceability: "追溯",
    stageScope: "范围",
    stageSource: "采集",
    stagePrepare: "清洗",
    stageTopics: "主题",
    stageFindings: "发现",
    stageEvidenceValidation: "证据验证",
    stagePlanning: "计划",
    stageRequirementEvidence: "需求证据",
    stageTests: "测试",
    stageTraceability: "追溯",
    stageRevision: "修订",
    waiting: "输入链接或导入评论以开始。",
    starting: "正在启动分析…",
    running: "分析进行中…",
    interrupted: "已中断",
    reconnecting: "正在重新连接…",
    goalTooShort: "分析目标至少需要 10 个字符。",
    invalidAppStoreUrl: "请输入有效的苹果 App Store 链接（例如 https://apps.apple.com/us/app/.../id123456789）",
    goalCharCount: "字符（至少需要 10 字符）",
    history: "历史",
    historyEmpty: "暂无历史运行。",
    historyLoadFailed: "加载历史失败。",
    view: "查看",
    replay: "回放",
    completed: "已完成",
    stageSkipped: "已跳过",
    failed: "失败",
    errors: "错误",
    limitations: "限制",
    assumptions: "假设",
    confidence: "置信度",
    supportCount: "支持评论数",
    aiGenerated: "AI 生成",
    computed: "确定性计算",
    source: "来源",
    conflict: "冲突",
    importFile: "导入 JSON 或 CSV",
    cachedReplay: "缓存回放",
    sourceLive: "实时采集",
    sourceImported: "已导入",
    sourcePartial: "部分数据",
    sourceSuspectEmpty: "可疑空数据",
    eventLog: "事件日志",
    showEvents: "显示事件",
    hideEvents: "隐藏事件",
    reviewId: "评论 ID",
    rating: "评分",
    version: "版本",
    language: "语言",
    ratingDistribution: "评分分布",
    versionDistribution: "版本分布",
    languageDistribution: "语言分布",
    status: "状态",
    body: "正文",
    title: "标题",
    noData: "暂无数据。",
    duplicates: "重复项",
    identityConflicts: "身份冲突",
    uncertain: "不确定",
    expected: "预期",
    normalized: "规范化",
    sourceId: "来源 ID",
    replaySource: "缓存回放",
    settings: "设置",
    modelBaseUrl: "API Base URL",
    modelApiKey: "API Key",
    modelName: "模型名称",
    modelJsonMode: "JSON 模式",
    modelReasoningEffort: "推理强度",
    modelReasoningEffortHint: "档位越高，单次调用耗时越长，输出质量可能越高。",
    save: "保存",
    saved: "已保存",
    close: "关闭",
    apiKeyConfigured: "已配置",
    apiKeyPlaceholder: "输入新 Key 以替换当前 Key",
    apiKeyClear: "清除 Key",
    configApplyError: "保存设置失败",
    dataSourceSettings: "数据采集平台",
    serpApiKey: "SerpApi API Key",
    serpApiKeyHint: "仅保存在本机，并由服务端用于强制实时采集 App Store 评论。",
    serpApiKeyConfigured: "SerpApi 已配置",
    serpApiKeyClear: "清除 SerpApi Key",
    checkingSample: "正在检查评论样本…",
    sampleCheckFailed: "无法检查评论样本。",
    liveSample: "实时样本",
    stableSample: "稳定样本",
    recommended: "推荐",
    liveReviews: "实时评论数",
    stableReviews: "稳定评论数",
    cacheUpdated: "缓存更新时间",
    sourceLiveCache: "实时 + 缓存",
    noSampleAvailable: "当前没有可用评论 — 请重新检查或改用导入。",
    recheck: "重新检查",
    useImportInstead: "改用导入",
    notChecked: "尚未检查",
    evidenceStrength: "证据强度",
    evidenceSufficient: "证据充分",
    evidenceInsufficient: "证据不足",
    supportRatio: "支持占比",
    freshReviews: "条最新采集评论",
    localHistoryReviews: "条本地历史评论",
    serpApiFresh: "SerpApi · 强制实时采集",
    appleRssFallback: "Apple RSS 降级采集",
    searchesUsed: "本次 SerpApi searches",
    analyzeFresh: "分析最新样本",
    analyzeHistory: "分析本地历史样本",
    freshnessCaveat: "已请求强制刷新；App Store 评论发布本身仍可能有延迟。",
    sourceSerpApi: "SerpApi / 美国区 App Store",
    sourceSerpApiHistory: "SerpApi / 美国区 App Store · 本地历史",
    sourceRssFallback: "Apple RSS 降级采集 / 美国区 App Store",
    sourceRssHistory: "Apple RSS 降级采集 / 美国区 App Store · 本地历史",
    requirementId: "需求",
    findingId: "发现",
    priority: "优先级",
    precondition: "前置条件",
    classification: "分类",
    evidenceValidation: "证据验证",
    finalDeliverables: "最终交付物",
    draft: "草稿",
    final: "终稿",
    noRevisionRequired: "终稿 · 无需修订",
    legacyArtifactUnavailable: "该缓存运行中不可用",
    versionRationale: "版本理由",
    factorSeverity: "严重程度",
    factorEvidenceStrength: "证据强度",
    factorConfidence: "置信度",
    factorUserImpact: "用户影响",
    factorFrequency: "出现频率",
    factorImplementationScope: "实施范围",
    factorDependency: "依赖关系",
    logicalCalls: "逻辑调用数",
    modelAttempts: "HTTP 尝试数",
    modelRetries: "重试次数",
    modelRetryReasons: "重试原因",
    promptVersions: "提示词版本",
    diagnosticsError: "错误",
    diagnosticsWarning: "警告",
    diagnosticsValidation: "校验",
    diagnosticsRevision: "修订",
    stageBatch: "批次",
    cleaningUnicode: "Unicode 规范化",
    cleaningWhitespace: "空白折叠",
    cleaningCaseFolded: "大小写折叠",
    cleaningLanguages: "语言标记",
    cleaningExactDuplicates: "精确重复已排除",
    cleaningIdentityConflicts: "身份冲突",
    cleaningShortKept: "保留的独立短评",
    goalCoverage: "目标覆盖",
    goalCoverageCovered: "已覆盖",
    goalCoverageUncovered: "未覆盖",
    goalCoverageUnsupported: "无充分证据",
    goalCoverageGap: "覆盖缺口",
    wizardStepSource: "选择数据来源",
    wizardStepConfigure: "配置输入",
    wizardStepConfirm: "确认并开始",
    liveModeDesc: "实时采集美国区 App Store 最新评论（SerpApi 主用，Apple RSS 备用）",
    importModeDesc: "导入本地 JSON 或 CSV 评论文件，无需联网采集",
    useExampleApp: "使用示例 App",
    back: "上一步",
    next: "下一步",
    confirmFile: "文件",
    collectionStatus: "采集",
    collectionConfigured: "SerpApi / Apple RSS 备用",
    runLog: "运行日志",
    eventCount: "事件数量",
    filterByStage: "按阶段筛选",
    filterByEventType: "按类型筛选",
    all: "全部",
    sequence: "序号",
    stage: "阶段",
    type: "类型",
    message: "消息",
    retry: "重试",
    retrying: "正在重试…",
    runFailed: "分析失败",
    openInAppStore: "在 App Store 中打开",
    importedFile: "导入文件",
    delete: "删除",
    deleteConfirm: "确定删除该运行？此操作不可恢复。",
    cancel: "取消",
    deleteFailed: "删除失败。",
    viewModeReport: "执行报告",
    viewModeWorkbench: "结构工作台",
    groupProduct: "产品规划",
    groupEvidence: "证据溯源",
    groupData: "数据与日志",
    filterAll: "全部",
    filterSearchPlaceholder: "搜索关键词或 ID...",
    filterPriority: "优先级",
    filterSufficiency: "证据充分度",
    filterResultsCount: "显示",
    copyMarkdownReport: "复制 Markdown 报告",
    copied: "已复制到剪贴板",
    copyFailed: "复制失败",
    printReport: "打印 / 导出 PDF",
    userQuote: "用户原声",
    confidenceLevel: "置信度",
    acceptanceCriteria: "验收准则",
    acceptanceCriteriaProvenance: "验收准则由模型生成，具体数值为建议目标，非评论证据推导",
    executiveSummary: "执行概要与评级",

    keyFindings: "核心用户痛点与发现",
    roadmapMilestones: "版本规划路线图与里程碑",
    requirementsSpecs: "PRD 需求规格与验收准则",
    verificationPlan: "测试用例与验证计划",
    noFilteredResults: "未找到匹配的项目。",
    exportPackage: "导出完整交付包 (Markdown)",
    downloadCsvTemplate: "下载示例 CSV 模板",
    topFindings: "核心用户痛点 Top 发现",
    appSummary: "分析目标与应用概要",
    dataCleaningDetails: "数据清洗与质检明细",
    traceMatrixTitle: "全链路追溯拓扑矩阵",
    traceMatrixSubtitle: "从评论证据到测试用例的完整映射",
    traceColFinding: "核心用户痛点 (Finding)",
    traceColReviews: "支撑评论样本 (Reviews)",
    traceColRequirement: "对应 PRD 需求 (Requirement)",
    traceColTests: "验收用例 (Test Cases)",
    traceStatusClosed: "已闭环",
    traceStatusViolation: "校验违规",
    traceStatusMissingTest: "缺测试",
    traceStatusUncovered: "未覆盖",
    jumpToReview: "跳转到评论",
    viewTestCases: "查看测试用例",
    viewPrdRequirement: "查看对应 PRD 需求",
    traceValidationSummary: "全链路证据与需求双向验证",
    traceRevisedPassed: "初版校验未通过（{count}）→ 已自动修订通过",
    traceCoverageLabel: "覆盖",
    traceCoverageFindings: "核心痛点",
    traceCoverageRequirements: "需求",
    finalDeliverablesSubtitle: "包含版本计划、PRD 规格书、测试用例与全链路追溯",
    exportPackageTitle: "App 评论分析与产品规划全案交付包",
    appNameLabel: "应用名称",
    appStoreLinkLabel: "App Store 链接",
    versionLabel: "版本",
    includedRequirements: "包含需求",
    supportingReviewIdsLabel: "支撑评论 ID",
    exportCorrespondsTo: "对应",
    noneValue: "无",
    testSteps: "测试步骤",
    tableOfContents: "目录",
    clearSearch: "清除搜索",
    copyFullId: "点击复制完整 ID",
    fullId: "完整 ID",
    importFormatHint: "支持 JSON 数组或 CSV 格式。必需字段：",
    orWord: "或",
    runNotFound: "运行不存在或已被删除。",
    traceClosureClosed: "已闭环",
    traceClosurePartial: "正式链路有效，仍有 {count} 条假设待验证",
    traceClosureAssumptionOnly: "证据不足，尚未形成产品计划",
    traceClosureInvalid: "追溯校验未通过",
    traceStatusAssumption: "待验证假设",
    noSchedulableRequirements: "无符合证据门槛的可排期需求",
    structuralValidation: "结构验证",
    productClosure: "产品闭环",
    sourceFindings: "来源发现",
    sourceReviews: "来源评论",
  },
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export function translateCode(code: string, locale: Locale = "zh-CN"): string {
  const zhMap: Record<string, string> = {
    SCOPE_LIMITATION: "分析范围说明",
    PLANNING_PRIORITY_CAPPED: "优先级自动调校",
    TOPIC_CANDIDATES_TRUNCATED: "候选主题集优化",
    SERPAPI_UPSTREAM_FAILED: "数据源采集降级",
    MODEL_NON_JSON_OUTPUT: "格式自愈重试",
    MODEL_NETWORK_ERROR: "网络抖动重试",
    MODEL_TRUNCATED_RESPONSE: "输出截断重试",
    REQUIREMENT_UNKNOWN_DEPENDENCY: "未知依赖需求",
    REQUIREMENT_INSUFFICIENT_EVIDENCE: "需求引用不足证据",
    INSUFFICIENT_FINDING_UNTRACKED: "不足发现未追踪假设",
    SUFFICIENT_FINDING_UNCOVERED: "充分发现未覆盖需求",
    REQUIREMENT_REJECTED_INSUFFICIENT_EVIDENCE: "需求因证据不足转假设",
    PLANNING_INSUFFICIENT_FINDING_DROPPED: "移除不足证据发现关联",
    "evidence-validation": "证据验证",
    findings: "痛点发现",
    planning: "产品规划",
    prepare: "数据准备",
    scope: "范围划定",
    source: "数据源采集",
    tests: "测试用例",
    topics: "主题聚类",
    traceability: "全链路追溯",
  };
  if (locale === "zh-CN" && zhMap[code]) return zhMap[code];
  return code;
}
