import { describe, expect, it } from "vitest";

import { isAllowedLicense } from "../../scripts/check-licenses.mjs";

describe("dependency license policy", () => {
  it("accepts the Project S license and rejects unlicensed packages", () => {
    expect(isAllowedLicense("Apache-2.0")).toBe(true);
    expect(isAllowedLicense("UNLICENSED")).toBe(false);
    expect(isAllowedLicense(undefined)).toBe(false);
  });
});
