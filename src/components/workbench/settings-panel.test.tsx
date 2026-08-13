import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./settings-panel";
import { getDictionary } from "@/i18n";

const tEn = getDictionary("en");
const tZh = getDictionary("zh-CN");

function mockFetch(json: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => json,
    }),
  );
}

/** GET returns the first status, POST returns the second. */
function configFetchSequence(getJson: unknown, postJson: unknown) {
  const fetchMock = vi.fn();
  fetchMock
    .mockResolvedValueOnce({ ok: true, json: async () => getJson })
    .mockResolvedValueOnce({ ok: true, json: async () => postJson });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsPanel", () => {
  it("renders the configured model fields prefilled from GET /api/config", async () => {
    mockFetch({
      modelConfigured: true,
      modelApiKeyConfigured: true,
      modelName: "deepseek-v4-flash",
      modelBaseUrl: "https://api.deepseek.com/v1",
      jsonMode: "prompt",
    });
    render(<SettingsPanel t={tEn} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByLabelText(tEn.modelBaseUrl)).toHaveValue("https://api.deepseek.com/v1");
    });
    expect(screen.getByLabelText(tEn.modelName)).toHaveValue("deepseek-v4-flash");
    // The API key is never exposed back to the client.
    expect(screen.getByLabelText(tEn.modelApiKey)).toHaveValue("");
    expect(screen.getByText(tEn.apiKeyConfigured)).toBeInTheDocument();
  });

  it("saves the api key and base url via POST /api/config", async () => {
    const fetchMock = vi.fn();
    mockFetch({});
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // POST
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SettingsPanel t={tEn} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByLabelText(tEn.modelBaseUrl)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(tEn.modelApiKey), "sk-my-key");
    await user.click(screen.getByRole("button", { name: tEn.save }));

    await waitFor(() => {
      // call 0 = GET /api/config, call 1 = POST /api/config
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      const postCall = fetchMock.mock.calls[1];
      expect(postCall[0]).toBe("/api/config");
      expect(postCall[1].method).toBe("POST");
      const body = JSON.parse(postCall[1].body);
      expect(body.modelApiKey).toBe("sk-my-key");
    });
  });

  it("shows an error when saving fails", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // GET
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ detail: "bad url" }) }); // POST
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SettingsPanel t={tEn} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByLabelText(tEn.modelBaseUrl)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(tEn.modelApiKey), "sk-x");
    await user.click(screen.getByRole("button", { name: tEn.save }));
    await waitFor(() => {
      expect(screen.getByText(tEn.configApplyError)).toBeInTheDocument();
    });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/config");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  });

  it("renders the model fields in Chinese after switching locale", async () => {
    mockFetch({ modelConfigured: false });
    render(<SettingsPanel t={tZh} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(tZh.settings)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(tZh.modelName)).toBeInTheDocument();
    expect(screen.getByLabelText(tZh.modelApiKey)).toBeInTheDocument();
  });

  it("shows configured SocialCrawl status without prefilling the secret", async () => {
    mockFetch({ socialCrawlApiKeyConfigured: true });
    render(<SettingsPanel t={tEn} open onClose={vi.fn()} />);
    const input = await screen.findByLabelText(tEn.socialCrawlApiKey);
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveValue("");
    expect(screen.getByText(tEn.socialCrawlApiKeyConfigured)).toBeVisible();
  });

  it("sends a newly entered SocialCrawl key and clears the input after save", async () => {
    const fetchMock = configFetchSequence(
      { socialCrawlApiKeyConfigured: false },
      { socialCrawlApiKeyConfigured: true },
    );
    const user = userEvent.setup();
    render(<SettingsPanel t={tEn} open onClose={vi.fn()} />);
    const input = await screen.findByLabelText(tEn.socialCrawlApiKey);
    await user.type(input, "sc_ui_test");
    await user.click(screen.getByRole("button", { name: tEn.save }));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ socialCrawlApiKey: "sc_ui_test" });
    await waitFor(() => expect(input).toHaveValue(""));
    expect(screen.getByText(tEn.socialCrawlApiKeyConfigured)).toBeVisible();
  });

  it("clears only the SocialCrawl key", async () => {
    const fetchMock = configFetchSequence(
      { socialCrawlApiKeyConfigured: true },
      { socialCrawlApiKeyConfigured: false },
    );
    const user = userEvent.setup();
    render(<SettingsPanel t={tEn} open onClose={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: tEn.socialCrawlApiKeyClear }));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ socialCrawlApiKey: null });
  });

  it("shows the SocialCrawl section labels in Chinese", async () => {
    mockFetch({ socialCrawlApiKeyConfigured: true });
    render(<SettingsPanel t={tZh} open onClose={vi.fn()} />);
    expect(await screen.findByText(tZh.dataSourceSettings)).toBeVisible();
    expect(screen.getByLabelText(tZh.socialCrawlApiKey)).toBeInTheDocument();
    expect(screen.getByText(tZh.socialCrawlApiKeyConfigured)).toBeVisible();
  });
});
