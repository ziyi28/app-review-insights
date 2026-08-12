import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Auto-unmount between tests so one test's rendered DOM never leaks into the
// next (which would duplicate elements and break getByRole/getByLabelText).
afterEach(() => {
  cleanup();
});
