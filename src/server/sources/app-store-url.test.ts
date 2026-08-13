import { describe, it, expect } from "vitest";
import { parseAppStoreUrl } from "./app-store-url";

describe("parseAppStoreUrl", () => {
  it("canonicalizes a China page URL to the US storefront", () => {
    expect(parseAppStoreUrl("https://apps.apple.com/cn/app/example/id839285684")).toEqual({
      appId: "839285684",
      inputStorefront: "cn",
      canonicalUrl: "https://apps.apple.com/us/app/example/id839285684",
    });
  });

  it("keeps a US page URL canonical", () => {
    expect(parseAppStoreUrl("https://apps.apple.com/us/app/example/id839285684")).toEqual({
      appId: "839285684",
      inputStorefront: "us",
      canonicalUrl: "https://apps.apple.com/us/app/example/id839285684",
    });
  });

  it("parses a valid US app store url", () => {
    expect(parseAppStoreUrl("https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684")).toEqual({
      appId: "839285684",
      inputStorefront: "us",
      canonicalUrl: "https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684",
    });
  });

  it("parses an id-only segment", () => {
    expect(parseAppStoreUrl("https://apps.apple.com/us/app/id839285684").appId).toBe("839285684");
  });

  it("rejects an unsupported storefront", () => {
    expect(() => parseAppStoreUrl("https://apps.apple.com/jp/app/example/id839285684"))
      .toThrow(/US or China/i);
  });

  it("rejects non-https", () => {
    expect(() => parseAppStoreUrl("http://apps.apple.com/us/app/x/id839285684")).toThrow(/https/i);
  });

  it("rejects a non-apple host", () => {
    expect(() => parseAppStoreUrl("https://evil.example.com/us/app/x/id839285684")).toThrow(/host/i);
  });

  it("rejects a missing numeric id", () => {
    expect(() => parseAppStoreUrl("https://apps.apple.com/us/app/x/no-id-here")).toThrow(/id/i);
  });
});
