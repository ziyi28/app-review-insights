import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Workbench } from "./workbench";
import { getDictionary } from "@/i18n";

const tEn = getDictionary("en");
const tZh = getDictionary("zh-CN");

function stubConfigFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/runs") {
        return Promise.resolve({ ok: true, json: async () => ({ runs: [] }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ modelConfigured: false, modelApiKeyConfigured: false, modelName: null, modelBaseUrl: null, jsonMode: "prompt" }),
      });
    }),
  );
}

describe("Workbench settings integration", () => {
  it("opens the settings panel from the header button", async () => {
    stubConfigFetch();
    const user = userEvent.setup();
    render(<Workbench />);
    await user.click(screen.getByRole("button", { name: tEn.settings }));
    expect(await screen.findByRole("dialog", { name: tEn.settings })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText(tEn.modelBaseUrl)).toBeInTheDocument();
    });
  });

  it("shows the settings panel in Chinese after switching the UI locale", async () => {
    stubConfigFetch();
    const user = userEvent.setup();
    render(<Workbench />);
    // Switch the header language select to 中文.
    const langSelect = screen.getByRole("combobox", { name: tEn.language });
    await user.selectOptions(langSelect, "zh-CN");
    await user.click(screen.getByRole("button", { name: tZh.settings }));
    expect(await screen.findByRole("dialog", { name: tZh.settings })).toBeInTheDocument();
    expect(screen.getByLabelText(tZh.modelBaseUrl)).toBeInTheDocument();
    expect(screen.getByLabelText(tZh.modelName)).toBeInTheDocument();
  });
});
