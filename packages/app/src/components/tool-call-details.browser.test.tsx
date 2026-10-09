import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { ToolCallDetailsContent } from "./tool-call-details";
import { buildToolCallDisplayModel } from "@/utils/tool-call-display";

// The native gesture scroll view is not used by the web renderer.
vi.mock("react-native-gesture-handler", async () => ({
  ScrollView: (await import("react-native")).ScrollView,
}));

vi.mock("react-native-unistyles", async () => {
  const { lightTheme } = await import("@/styles/theme");
  return {
    StyleSheet: {
      create: (styles: unknown) => (typeof styles === "function" ? styles(lightTheme) : styles),
    },
    useUnistyles: () => ({ theme: lightTheme, rt: {} }),
  };
});

const reason = "progress_checkpoint rejected: no progress checkpoint is currently required";
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function mountFailure(output?: string) {
  return mountDetail({ type: "shell", command: "Running Progress Checkpoint", output });
}

function mountDetail(detail: ToolCallDetail) {
  const display = buildToolCallDisplayModel({
    name: "progress_checkpoint",
    status: "failed",
    error: { message: reason },
    detail,
  });
  const container = document.createElement("div");
  container.style.cssText = "width: 360px; padding: 16px; background: #fafafa";
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => root.render(<ToolCallDetailsContent detail={detail} errorText={display.errorText} />));
  return container;
}

describe("tool failure details", () => {
  it("shows a wrapped diagnostic without a JSON error box", async () => {
    const container = mountFailure();
    await page.screenshot({ element: container });
    expect(container.textContent).toContain(reason);
    expect(container.textContent).not.toContain('"message"');
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(reason);
    expect(getComputedStyle(alert!).whiteSpace).not.toBe("pre");
    expect(alert!.scrollWidth).toBeLessThanOrEqual(alert!.clientWidth);
    expect(alert!.clientHeight).toBeGreaterThan(18);
  });

  it("shows a diagnostic once when shell output already contains it", async () => {
    const container = mountFailure(`error: ${reason}`);
    await page.screenshot({ element: container });
    expect(container.textContent?.split(reason).length).toBe(2);
  });

  it.each([
    { type: "plain_text" as const, text: reason },
    { type: "read" as const, filePath: "missing.txt", content: `error: ${reason}` },
  ])("shows a diagnostic once in $type output", (detail) => {
    expect(mountDetail(detail).textContent?.split(reason).length).toBe(2);
  });

  it("retains different failure feedback beside command output", () => {
    const container = mountFailure("Earlier command diagnostics");
    expect(container.textContent).toContain("Earlier command diagnostics");
    expect(container.textContent).toContain(reason);
  });
});
