/**
 * Robustly extracts a JSON object from a model response. Accepts pure JSON,
 * fenced ```json blocks, or JSON embedded in surrounding text.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to extraction strategies
  }

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      // fall through
    }
  }

  // Extract the first balanced {...} JSON object. Taking the first "{" to the
  // last "}" would fail on valid output like `Result: {"a":1}. Note: use {x}`
  // (the trailing object makes the slice non-JSON). Scan for a balanced object
  // so the first complete JSON object wins.
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < trimmed.length; j++) {
      const ch = trimmed[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = trimmed.slice(i, j + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break; // not a valid object, try the next "{"
          }
        }
      }
    }
    if (depth > 0) break; // unbalanced from here; no valid object remains
  }

  throw new Error("Model response did not contain valid JSON");
}
