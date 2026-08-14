import { describe, it, expect } from "vitest";
import { parseAppStoreUrl, extractAppNameFromUrl } from "./app-store-url";

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

describe("extractAppNameFromUrl", () => {
  it("extracts and formats title-cased app name from English kebab-case slug", () => {
    expect(
      extractAppNameFromUrl("https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684")
    ).toBe("Workout For Women Home Gym");
  });

  it("decodes URL-encoded Chinese app names", () => {
    expect(
      extractAppNameFromUrl("https://apps.apple.com/cn/app/%E5%BE%AE%E4%BF%A1/id414478124")
    ).toBe("微信");
  });

  it("returns undefined for id-only URLs without slug", () => {
    expect(extractAppNameFromUrl("https://apps.apple.com/us/app/id839285684")).toBeUndefined();
  });

  it("returns undefined for invalid URLs", () => {
    expect(extractAppNameFromUrl("not-a-url")).toBeUndefined();
    expect(extractAppNameFromUrl("https://apps.apple.com/us/app/no-id")).toBeUndefined();
  });
});
