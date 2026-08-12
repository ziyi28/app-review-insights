import { describe, it, expect } from "vitest";
import { parseUsAppStoreUrl } from "./app-store-url";

describe("parseUsAppStoreUrl", () => {
  it("parses a valid US app store url", () => {
    expect(parseUsAppStoreUrl("https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684")).toEqual({
      appId: "839285684",
      canonicalUrl: "https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684",
    });
  });

  it("parses an id-only segment", () => {
    expect(parseUsAppStoreUrl("https://apps.apple.com/us/app/id839285684").appId).toBe("839285684");
  });

  it("rejects non-https", () => {
    expect(() => parseUsAppStoreUrl("http://apps.apple.com/us/app/x/id839285684")).toThrow(/https/i);
  });

  it("rejects a non-apple host", () => {
    expect(() => parseUsAppStoreUrl("https://evil.example.com/us/app/x/id839285684")).toThrow(/host/i);
  });

  it("rejects a non-US storefront", () => {
    expect(() => parseUsAppStoreUrl("https://apps.apple.com/cn/app/x/id839285684")).toThrow(/US storefront/i);
  });

  it("rejects a missing numeric id", () => {
    expect(() => parseUsAppStoreUrl("https://apps.apple.com/us/app/x/no-id-here")).toThrow(/id/i);
  });
});
