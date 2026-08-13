export type Locale = "en" | "zh-CN";

export type Dictionary = {
  appTitle: string;
  newRun: string;
  liveMode: string;
  importMode: string;
  replayMode: string;
  appStoreUrl: string;
  goal: string;
  outputLocale: string;
  start: string;
  uiLanguage: string;
  modelStatus: string;
  modelConfigured: string;
  modelNotConfigured: string;
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
  stageTests: string;
  stageTraceability: string;
  stageRevision: string;
  waiting: string;
  starting: string;
  running: string;
  completed: string;
  someEventsDropped: string;
  goalTooShort: string;
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
  checkSample: string;
  checkingSample: string;
  sampleCheckFailed: string;
  liveSample: string;
  stableSample: string;
  recommended: string;
  liveReviews: string;
  stableReviews: string;
  cacheUpdated: string;
  chooseLive: string;
  chooseStable: string;
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
  sampleAnalyzed: string;
  sampleOf: string;
  sampleStratified: string;
};

export const dictionaries: Record<Locale, Dictionary> = {
  en: {
    appTitle: "App Review Planner",
    newRun: "New Run",
    liveMode: "Live",
    importMode: "Import",
    replayMode: "Cached Replay",
    appStoreUrl: "App Store URL (reviews use the US storefront)",
    goal: "Analysis goal",
    outputLocale: "Output language",
    start: "Start",
    uiLanguage: "Language",
    modelStatus: "Model",
    modelConfigured: "Configured",
    modelNotConfigured: "Not configured",
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
    stageTests: "Tests",
    stageTraceability: "Traceability",
    stageRevision: "Revision",
    waiting: "Enter a URL or import reviews to begin.",
    starting: "Starting analysis…",
    running: "Analysis running…",
    someEventsDropped: "Some stream events were dropped — check the browser console.",
    goalTooShort: "Analysis goal must be at least 10 characters.",
    history: "History",
    historyEmpty: "No past runs yet.",
    historyLoadFailed: "Failed to load history.",
    view: "View",
    replay: "Replay",
    completed: "Completed",
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
    checkSample: "Check review sample",
    checkingSample: "Checking review sample…",
    sampleCheckFailed: "Could not check the review sample.",
    liveSample: "Live sample",
    stableSample: "Stable sample",
    recommended: "Recommended",
    liveReviews: "Live reviews",
    stableReviews: "Stable reviews",
    cacheUpdated: "Cache updated",
    chooseLive: "Analyze live sample",
    chooseStable: "Analyze stable sample",
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
    sampleAnalyzed: "Analyzed",
    sampleOf: "of scope-matching reviews",
    sampleStratified: "stratified sample",
  },
  "zh-CN": {
    appTitle: "App 评论分析台",
    newRun: "新建运行",
    liveMode: "实时采集",
    importMode: "导入",
    replayMode: "缓存回放",
    appStoreUrl: "App Store 链接（评论统一使用美国区）",
    goal: "分析目标",
    outputLocale: "输出语言",
    start: "开始分析",
    uiLanguage: "界面语言",
    modelStatus: "模型",
    modelConfigured: "已配置",
    modelNotConfigured: "未配置",
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
    stageTests: "测试",
    stageTraceability: "追溯",
    stageRevision: "修订",
    waiting: "输入链接或导入评论以开始。",
    starting: "正在启动分析…",
    running: "分析进行中…",
    someEventsDropped: "部分流事件被丢弃 — 请查看浏览器控制台。",
    goalTooShort: "分析目标至少需要 10 个字符。",
    history: "历史",
    historyEmpty: "暂无历史运行。",
    historyLoadFailed: "加载历史失败。",
    view: "查看",
    replay: "回放",
    completed: "已完成",
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
    checkSample: "检查评论样本",
    checkingSample: "正在检查评论样本…",
    sampleCheckFailed: "无法检查评论样本。",
    liveSample: "实时样本",
    stableSample: "稳定样本",
    recommended: "推荐",
    liveReviews: "实时评论数",
    stableReviews: "稳定评论数",
    cacheUpdated: "缓存更新时间",
    chooseLive: "分析实时样本",
    chooseStable: "分析稳定样本",
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
    sampleAnalyzed: "已分析",
    sampleOf: "条范围匹配评论",
    sampleStratified: "分层样本",
  },
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
