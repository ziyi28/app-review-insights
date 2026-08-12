/**
 * Parses and strictly validates a US App Store app URL.
 * The server never fetches the user-supplied URL; it only extracts the app ID
 * and constructs an Apple RSS URL from it (SSRF guard).
 */
export type ParsedAppStoreUrl = {
  appId: string;
  canonicalUrl: string;
};

export function parseUsAppStoreUrl(input: string): ParsedAppStoreUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("URL must use https");
  }
  if (url.hostname !== "apps.apple.com") {
    throw new Error(`Unexpected host: ${url.hostname}`);
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "us") {
    throw new Error("Only the US storefront is supported");
  }

  const idSegment = segments.find((s) => s.startsWith("id") && /^\d+$/.test(s.slice(2)));
  if (!idSegment) {
    throw new Error("URL must contain a numeric id<number> segment");
  }
  const appId = idSegment.slice(2);

  // Keep the original path shape but ensure the final segment is the numeric id.
  const withoutId = segments.filter((s) => s !== idSegment);
  const canonicalUrl = `https://apps.apple.com/${withoutId.join("/")}/id${appId}`;
  return { appId, canonicalUrl };
}
