import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { PromptRegistry } from "./prompts";

describe("prompt registry", () => {
  it("registers all prompt versions and each has a stable hash", () => {
    for (const [id, prompt] of Object.entries(PromptRegistry)) {
      const hash = createHash("sha256").update(prompt.system + prompt.version).digest("hex");
      expect(hash.length).toBe(64);
      expect(prompt.version).toMatch(/@\d+$/);
      expect(prompt.schema).toBeDefined();
      expect(typeof prompt.buildUser).toBe("function");
      void id;
    }
  });

  it("does not contain a fixed topic taxonomy", () => {
    const allSystem = Object.values(PromptRegistry).map((p) => p.system).join("\n");
    const forbidden = ["subscription", "price", "timer", "workout", "payment", "billing", "premium"];
    for (const word of forbidden) {
      expect(allSystem.toLowerCase()).not.toContain(word);
    }
  });

  it("explicitly treats review text as untrusted data in every prompt", () => {
    for (const p of Object.values(PromptRegistry)) {
      expect(p.system).toMatch(/UNTRUSTED/i);
    }
  });

  it("has versioned prompt ids matching file versions", () => {
    expect(PromptRegistry["scope"].version).toBe("scope@1");
    expect(PromptRegistry["topic-discovery"].version).toBe("topics.discovery@2");
    expect(PromptRegistry["topic-consolidation"].version).toBe("topics.consolidation@2");
    expect(PromptRegistry["findings"].version).toBe("findings@2");
    expect(PromptRegistry["planning"].version).toBe("planning@2");
    expect(PromptRegistry["tests"].version).toBe("tests@1");
    expect(PromptRegistry["revision"].version).toBe("revision@1");
  });
});
