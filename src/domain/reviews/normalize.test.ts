import { describe, it, expect } from "vitest";
import { normalizeBody, normalizeTitle, deriveLanguage } from "./normalize";

describe("normalizeBody", () => {
  it("collapses unicode whitespace and folds case for comparison", () => {
    const out = normalizeBody("  Great\t\n  App!  \r\n  Second  line ");
    expect(out).toBe("great app! second line");
  });

  it("preserves original text separately (caller keeps bodyOriginal)", () => {
    // normalize only produces the comparison form; original is untouched upstream.
    expect(normalizeBody("UPPER  Case")).toBe("upper case");
  });

  it("handles NFC normalization", () => {
    // "e" + combining acute -> composed é
    const decomposed = "café";
    expect(normalizeBody(decomposed)).toBe("café");
  });
});

describe("normalizeTitle", () => {
  it("collapses whitespace but keeps display title", () => {
    expect(normalizeTitle("  Love\n it  ")).toBe("Love it");
  });
});

describe("deriveLanguage", () => {
  it("labels English text as en", () => {
    expect(deriveLanguage("The workout timer is great and easy to follow at home.")).toBe("en");
  });

  it("labels short ASCII text as und", () => {
    expect(deriveLanguage("hi")).toBe("und");
  });

  it("labels Chinese text as zh", () => {
    expect(deriveLanguage("这个应用的训练计划非常好用，动作讲解很清晰。")).toBe("zh");
  });

  it("labels mixed Chinese and English as mixed", () => {
    expect(deriveLanguage("训练很好很好 but timer glitches")).toBe("mixed");
  });

  it("labels other scripts as other", () => {
    expect(deriveLanguage("Это приложение отличное")).toBe("other");
  });

  it("labels empty as und", () => {
    expect(deriveLanguage("")).toBe("und");
  });
});
