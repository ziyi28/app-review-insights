import { describe, it, expect } from "vitest";
import { extractJsonObject } from "./parse-json";

describe("extractJsonObject", () => {
  it("passes through pure json", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("extracts json from a fenced code block", () => {
    const text = 'Here is the result:\n```json\n{"a":1}\n```\nDone.';
    expect(extractJsonObject(text)).toEqual({ a: 1 });
  });

  it("extracts json without a fence", () => {
    const text = 'Result: {"a":1} and more';
    expect(extractJsonObject(text)).toEqual({ a: 1 });
  });

  it("strips reasoning/think tags containing invalid or draft json", () => {
    const text = `<think>
Let me think about this.
Here is an unfinished draft: { "draft": 1
And some ideas { foo }
</think>
Here is the final output:
\`\`\`json
{"final": true, "count": 42}
\`\`\``;
    expect(extractJsonObject(text)).toEqual({ final: true, count: 42 });
  });

  it("handles text with an unbalanced opening brace before the real json", () => {
    const text = 'Look at { this invalid prefix. Actual output: {"valid": 123}';
    expect(extractJsonObject(text)).toEqual({ valid: 123 });
  });

  it("extracts the target json when multiple code blocks exist", () => {
    const text = `Explanation of data schema:
\`\`\`json
{ "example": "schema" }
\`\`\`
Now here is the full analysis:
\`\`\`json
{ "topics": [{ "id": "topic-1", "label": "UI" }] }
\`\`\``;
    expect(extractJsonObject(text)).toEqual({
      topics: [{ id: "topic-1", label: "UI" }],
    });
  });

  it("fixes trailing commas in objects and arrays", () => {
    const text = '{"topics": ["t1", "t2", ], "meta": {"count": 2, }, }';
    expect(extractJsonObject(text)).toEqual({
      topics: ["t1", "t2"],
      meta: { count: 2 },
    });
  });

  it("repairs strings with unescaped newlines and tabs", () => {
    const text = `{"summary": "Line 1
Line 2\tTabbed", "id": 1}`;
    expect(extractJsonObject(text)).toEqual({
      summary: "Line 1\nLine 2\tTabbed",
      id: 1,
    });
  });

  it("repairs Python boolean and null constants", () => {
    const text = '{"active": True, "disabled": False, "details": None}';
    expect(extractJsonObject(text)).toEqual({
      active: true,
      disabled: false,
      details: null,
    });
  });

  it("removes single-line and multi-line comments", () => {
    const text = `// Top-level comment
{
  /* inline comment */
  "name": "report", // trailing comment
  "count": 10
}`;
    expect(extractJsonObject(text)).toEqual({
      name: "report",
      count: 10,
    });
  });

  it("repairs single quoted keys and values", () => {
    const text = "{'name': 'test', 'enabled': true}";
    expect(extractJsonObject(text)).toEqual({
      name: "test",
      enabled: true,
    });
  });

  it("auto-completes slightly truncated closing braces and brackets", () => {
    const text = '{"title": "Analysis", "items": [{"id": "item-1"}';
    expect(extractJsonObject(text)).toEqual({
      title: "Analysis",
      items: [{ id: "item-1" }],
    });
  });

  it("throws a clear error on non-json", () => {
    expect(() => extractJsonObject("this is not json")).toThrow(/JSON/i);
  });
});
