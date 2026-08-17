import { describe, it, expect } from "vitest";
import { translateLimitationMessage, LIMITATION_MESSAGE_TEMPLATES } from "./limitation-messages";

describe("translateLimitationMessage", () => {
  it("renders a parameterized code in the requested locale", () => {
    expect(translateLimitationMessage("RSS_PARTIAL", "en", { page: 2 })).toBe(
      "Page 2 fetch failed; continuing with collected reviews",
    );
    expect(translateLimitationMessage("RSS_PARTIAL", "zh-CN", { page: 2 })).toBe(
      "第 2 页抓取失败；继续使用已采集的评论",
    );
  });

  it("substitutes every placeholder from params", () => {
    expect(
      translateLimitationMessage("INSUFFICIENT_EVIDENCE", "zh-CN", { count: 2, total: 7 }),
    ).toBe("2/7 个发现缺乏支持广泛或关键结论的证据");
  });

  it("falls back to the persisted message for an unknown code", () => {
    expect(translateLimitationMessage("UNKNOWN_CODE", "zh-CN", undefined, "legacy english")).toBe("legacy english");
    expect(translateLimitationMessage("UNKNOWN_CODE", "zh-CN")).toBe("UNKNOWN_CODE");
  });

  it("falls back to the persisted message when params are missing", () => {
    // A param-requiring code with no params must not render a bare {page}.
    expect(translateLimitationMessage("RSS_PARTIAL", "zh-CN", undefined, "fallback")).toBe("fallback");
    expect(translateLimitationMessage("RSS_PARTIAL", "zh-CN", { page: 3 })).toBe(
      "第 3 页抓取失败；继续使用已采集的评论",
    );
  });

  it("renders a param-less code even without params", () => {
    expect(translateLimitationMessage("SERPAPI_EMPTY", "zh-CN", undefined)).toBe(
      "SerpApi 未返回有效评论；可用性不确定",
    );
  });

  it("covers every system limitation code in both locales", () => {
    for (const [code, template] of Object.entries(LIMITATION_MESSAGE_TEMPLATES)) {
      expect(template.en.trim().length, `${code}.en`).toBeGreaterThan(0);
      expect(template.zh.trim().length, `${code}.zh`).toBeGreaterThan(0);
    }
  });
});
