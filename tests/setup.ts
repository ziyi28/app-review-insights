import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Auto-unmount between tests so one test's rendered DOM never leaks into the
// next (which would duplicate elements and break getByRole/getByLabelText),
// and clear persisted UI state (e.g. last-run-id) so a test that writes
// localStorage cannot change what the next test restores.
afterEach(() => {
  cleanup();
  // jsdom-only: Node-environment suites have no localStorage.
  if (typeof localStorage !== "undefined") localStorage.clear();
});
