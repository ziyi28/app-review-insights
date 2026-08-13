/**
 * Parses and strictly validates an App Store app page URL from either the US
 * or China storefront. The server never fetches the user-supplied URL; it only
 * extracts the app ID and constructs a canonical US URL plus the fixed Apple
 * RSS URL from it (SSRF guard). Review data always comes from the US storefront
 * regardless of which page the user entered.
 */
export type ParsedAppStoreUrl = {
  appId: string;
  inputStorefront: "us" | "cn";
  canonicalUrl: string;
};

export function parseAppStoreUrl(input: string): ParsedAppStoreUrl {
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
  const storefront = segments[0];
  if (storefront !== "us" && storefront !== "cn") {
    throw new Error("Only US or China App Store pages are supported");
  }
  const idSegment = segments.find((segment) => /^id\d+$/.test(segment));
  if (!idSegment) {
    throw new Error("URL must contain a numeric id<number> segment");
  }
  const appId = idSegment.slice(2);
  const pagePath = segments.slice(1).filter((segment) => segment !== idSegment).join("/");
  return {
    appId,
    inputStorefront: storefront,
    canonicalUrl: `https://apps.apple.com/us/${pagePath}/id${appId}`,
  };
}
