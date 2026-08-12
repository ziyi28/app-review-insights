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
  stagePlanning: string;
  stageTests: string;
  stageTraceability: string;
  stageRevision: string;
  waiting: string;
  running: string;
  completed: string;
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
};

export const dictionaries: Record<Locale, Dictionary> = {
  en: {
    appTitle: "App Review Planner",
    newRun: "New Run",
    liveMode: "Live",
    importMode: "Import",
    replayMode: "Cached Replay",
    appStoreUrl: "US App Store URL",
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
    stagePlanning: "Planning",
    stageTests: "Tests",
    stageTraceability: "Traceability",
    stageRevision: "Revision",
    waiting: "Enter a URL or import reviews to begin.",
    running: "Analysis running…",
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
  },
  "zh-CN": {
    appTitle: "App 评论分析台",
    newRun: "新建运行",
    liveMode: "实时采集",
    importMode: "导入",
    replayMode: "缓存回放",
    appStoreUrl: "美国区 App Store 链接",
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
    stagePlanning: "计划",
    stageTests: "测试",
    stageTraceability: "追溯",
    stageRevision: "修订",
    waiting: "输入链接或导入评论以开始。",
    running: "分析进行中…",
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
  },
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
