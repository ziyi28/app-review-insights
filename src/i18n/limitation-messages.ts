import type { Locale } from "./index";

/**
 * Locale templates for system limitation messages (source collectors and the
 * orchestrator). Only the *system* limitations live here — model-generated
 * finding limitations are natural-language outputLocale content and are never
 * translated. `{param}` placeholders are substituted from `Limitation.params`.
 * Unknown codes fall back to the persisted English message so old snapshots and
 * future codes stay readable.
 */

type Template = { en: string; zh: string };

export const LIMITATION_MESSAGE_TEMPLATES: Record<string, Template> = {
  // --- Apple RSS ---
  RSS_FETCH_FAILED: {
    en: "Page {page} fetch failed: {detail}",
    zh: "第 {page} 页抓取失败：{detail}",
  },
  RSS_PARTIAL: {
    en: "Page {page} fetch failed; continuing with collected reviews",
    zh: "第 {page} 页抓取失败；继续使用已采集的评论",
  },
  RSS_NON_JSON: {
    en: "Page {page} returned HTTP 200 but its body is not a valid Apple RSS feed",
    zh: "第 {page} 页返回 HTTP 200，但正文不是有效的 Apple RSS 数据",
  },
  RSS_SUSPECT_EMPTY: {
    en: "Apple RSS returned an HTTP 200 empty feed on page 1 after retries; review availability is uncertain and cannot be reported as 'no reviews'",
    zh: "Apple RSS 在第 1 页重试后仍返回 HTTP 200 空数据；评论可用性不确定，不能报告为「无评论」",
  },
  RSS_UNSTABLE_PAGINATION: {
    en: "Page {page} is empty while {lastPage} pages are advertised; ending pagination early",
    zh: "第 {page} 页为空，但广告页数为 {lastPage}；提前结束分页",
  },
  RSS_REPEATED_PAGE: {
    en: "Page {page} body is byte-identical to the previous page; stopping pagination",
    zh: "第 {page} 页正文与上一页逐字节相同；停止分页",
  },
  RSS_APP_CAP: {
    en: "Apple RSS returned more than {limit} reviews; the sample was capped at {limit}",
    zh: "Apple RSS 返回的评论超过 {limit} 条；样本已截断为 {limit} 条",
  },

  // --- SerpApi ---
  SERPAPI_PARTIAL: {
    en: "SerpApi review collection stopped after a page failure; collected pages were kept",
    zh: "SerpApi 评论采集因页面失败而停止；已保留已采集的页面",
  },
  SERPAPI_EMPTY: {
    en: "SerpApi returned no valid reviews; availability is uncertain",
    zh: "SerpApi 未返回有效评论；可用性不确定",
  },
  SERPAPI_ITEMS_DROPPED: {
    en: "{count} SerpApi review(s) were malformed and dropped; valid reviews were kept",
    zh: "{count} 条 SerpApi 评论格式异常已被丢弃；保留有效评论",
  },
  SERPAPI_APP_CAP: {
    en: "SerpApi returned more than {limit} reviews; the sample was capped at {limit}",
    zh: "SerpApi 返回的评论超过 {limit} 条；样本已截断为 {limit} 条",
  },
  SERPAPI_PAGE_CAP: {
    en: "SerpApi pagination stopped at {limit} pages (max); collected reviews were kept",
    zh: "SerpApi 分页在 {limit} 页（上限）处停止；保留已采集的评论",
  },
  SERPAPI_INVALID_RESPONSE: {
    en: "SerpApi returned an invalid or unreadable response",
    zh: "SerpApi 返回了无效或无法读取的响应",
  },
  SERPAPI_TIMEOUT: {
    en: "SerpApi request timed out",
    zh: "SerpApi 请求超时",
  },
  SERPAPI_ABORTED: {
    en: "SerpApi request aborted by the caller",
    zh: "SerpApi 请求已被调用方中止",
  },
  SERPAPI_UPSTREAM_FAILED: {
    en: "SerpApi upstream failure; fell back to Apple RSS",
    zh: "SerpApi 上游失败；已回退到 Apple RSS",
  },
  SERPAPI_FETCH_FAILED: {
    en: "SerpApi request failed: network error",
    zh: "SerpApi 请求失败：网络错误",
  },
  SERPAPI_NOT_CONFIGURED: {
    en: "SerpApi is not configured; falling back to Apple RSS",
    zh: "未配置 SerpApi；回退到 Apple RSS",
  },

  // --- Orchestrator / pipeline ---
  SCOPE_LIMITATION: {
    en: "Scope limitation: {detail}",
    zh: "范围限制：{detail}",
  },
  SCOPE_EMPTY: {
    en: "The selected scope filters matched no reviews; no model analysis was run",
    zh: "所选范围过滤未匹配到任何评论；未运行模型分析",
  },
  INSUFFICIENT_EVIDENCE: {
    en: "{count} of {total} findings have insufficient evidence for broad or critical claims",
    zh: "{count}/{total} 个发现缺乏支持广泛或关键结论的证据",
  },
  GOAL_AREA_UNCOVERED: {
    en: "Goal dimension {area} has sufficient evidence but no requirement was produced for it",
    zh: "目标维度 {area} 有充分证据，但未为其生成需求",
  },
  GOAL_AREA_UNSUPPORTED: {
    en: "Goal dimension {area} has no sufficient evidence to support a requirement",
    zh: "目标维度 {area} 没有足够证据来支撑需求",
  },
  TRACEABILITY_INVALID_AFTER_REVISION: {
    en: "Traceability validation failed after the constrained revision; the run cannot claim a consistent review-to-test chain",
    zh: "约束修订后全链路追溯校验仍失败；无法声明一致的 review→test 链路",
  },
  PIPELINE_ERROR: {
    en: "Pipeline error: {detail}",
    zh: "流水线错误：{detail}",
  },
  MODEL_NOT_CONFIGURED: {
    en: "No model is configured; deterministic stages ran without model analysis",
    zh: "未配置模型；确定性阶段已运行，未执行模型分析",
  },
  IMPORT_ERROR: {
    en: "Import error: {detail}",
    zh: "导入错误：{detail}",
  },
  SUPPORT_CONTENT_GROUP_DEDUPED: {
    en: "{count} supporting review(s) collapse to {groups} distinct content group(s); support count uses {groups}",
    zh: "{count} 条支持评论归并为 {groups} 个不同内容组；支持数以 {groups} 计",
  },
};

function fill(template: string, params?: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params && params[key] !== undefined ? String(params[key]) : `{${key}}`,
  );
}

/** The placeholder keys a template requires, e.g. ["page"] for "Page {page} …". */
function placeholderKeys(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

/**
 * Renders a system limitation message in the requested UI locale. `code` is
 * looked up in the template table. When the template needs params that the
 * limitation does not carry (e.g. a legacy snapshot), the persisted English
 * `fallbackMessage` is shown instead so a bare `{page}` never renders.
 */
export function translateLimitationMessage(
  code: string,
  locale: Locale,
  params?: Record<string, string | number>,
  fallbackMessage?: string,
): string {
  const template = LIMITATION_MESSAGE_TEMPLATES[code];
  if (!template) return fallbackMessage ?? code;
  const text = locale === "zh-CN" ? template.zh : template.en;
  const missing = placeholderKeys(text).some((key) => !params || params[key] === undefined);
  if (missing) return fallbackMessage ?? text;
  return fill(text, params);
}
