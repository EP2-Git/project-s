import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ErrorState from "../../src/components/booking/ErrorState";

describe("ErrorState", () => {
  it("announces the failure and supports retry", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();

    render(<ErrorState message="Synthetic failure" onRetry={retry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Synthetic failure");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("omits retry when no callback is provided", () => {
    render(<ErrorState />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
