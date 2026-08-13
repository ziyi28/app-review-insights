import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "./page";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workbench shell", () => {
  it("renders the Chinese workbench heading and the three source-mode choices", () => {
    // The shell fetches the replay catalog and config status on mount; both are
    // optional and must not block the first paint.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ runs: [], modelConfigured: false }) }));
    render(<Home />);
    expect(screen.getByRole("heading", { name: /App 评论分析台/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /实时采集/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /导入/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /缓存回放/ })).toBeInTheDocument();
  });
});
