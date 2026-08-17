import { createHash } from "node:crypto";
import { franc } from "franc-min";
import type { LanguageTag } from "@/domain/contracts/review";

/** NFC-normalize, normalize line endings, collapse whitespace. */
export function normalizeBody(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Stable id for the normalized review body, used as the dedupe "content group".
 * Only the body is hashed — rating/version/updatedAt are deliberately excluded,
 * so the same text resubmitted across dates (a re-sync or an adversarial copy)
 * collapses to the same group instead of inflating support counts. Mirrors the
 * sha256/slice(0,20) scheme already used for stableReviewId in dedupe.ts.
 */
export function deriveContentGroupId(bodyNormalized: string): string {
  return createHash("sha256").update(bodyNormalized).digest("hex").slice(0, 20);
}

/** Display title: collapse whitespace, keep case. */
export function normalizeTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const HAN = /[㐀-䶿一-鿿]/g;
const LATIN = /[A-Za-z]/g;

/**
 * Deterministic language label used only for filtering/display, never as a
 * semantic classification. Short or ASCII-only text is "und"; Han+Latin
 * mixes are "mixed"; franc is consulted for longer text.
 */
export function deriveLanguage(text: string): LanguageTag {
  const trimmed = text.trim();
  if (!trimmed) return "und";
  // Reset lastIndex before each test/match: the global flag on the shared
  // regexes would otherwise retain position across calls and return wrong
  // results (e.g. matching on every other review).
  HAN.lastIndex = 0;
  LATIN.lastIndex = 0;
  const hasHan = HAN.test(trimmed);
  const hasLatin = LATIN.test(trimmed);

  if (hasHan && hasLatin) {
    HAN.lastIndex = 0;
    LATIN.lastIndex = 0;
    const zhShare = (trimmed.match(HAN) ?? []).length;
    const enShare = (trimmed.match(LATIN) ?? []).length;
    const min = Math.min(zhShare, enShare);
    if (min >= 5 && Math.abs(zhShare - enShare) <= 20) return "mixed";
    return zhShare >= enShare ? "zh" : "en";
  }
  if (hasHan) return "zh";
  if (!hasLatin) {
    // Non-Han, non-Latin scripts (Cyrillic, etc.)
    if (trimmed.length < 2) return "und";
    return "other";
  }
  if (trimmed.length < 5) return "und";
  const top = franc(trimmed);
  if (top === "eng") return "en";
  if (top === "cmn" || top === "cmn-Hans" || top === "cmn-Hant") return "zh";
  return "other";
}
