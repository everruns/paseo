import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const reason = "progress_checkpoint rejected: no progress checkpoint is currently required";

async function installSemanticFailure(page: Page, agentId: string) {
  let callId: string | undefined;
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const text = typeof message === "string" ? message : message.toString("utf8");
      const envelope = JSON.parse(text) as {
        type?: string;
        message?: {
          type?: string;
          payload?: {
            agentId?: string;
            event?: {
              type?: string;
              item?: {
                type?: string;
                callId?: string;
                status?: string;
                name?: string;
                error?: unknown;
                detail?: unknown;
                metadata?: unknown;
              };
            };
          };
        };
      };
      const payload = envelope.message?.payload;
      const item = payload?.event?.item;
      if (
        envelope.type === "session" &&
        envelope.message?.type === "agent_stream" &&
        payload?.agentId === agentId &&
        payload.event?.type === "timeline" &&
        item?.type === "tool_call"
      ) {
        callId ??= item.callId;
        if (item.callId === callId && item.status === "completed") {
          item.status = "failed";
          item.name = "shell";
          item.metadata = { title: "Running Progress Checkpoint", kind: "execute" };
          item.error = { message: reason };
          item.detail = {
            type: "shell",
            command: "Running Progress Checkpoint",
            output: `error: ${reason}`,
          };
          ws.send(JSON.stringify(envelope));
          return;
        }
      }
      ws.send(text);
    });
  });
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`tool failures at ${viewport.width}px`, () => {
    test.use({ viewport });
    test("shows a semantic diagnostic once inside tool details", async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const agent = await seedMockAgentWorkspace({
        repoPrefix: "tool-failure-details-",
        title: "Semantic tool failure",
        model: "ten-second-stream",
      });
      try {
        await page.addInitScript(() => {
          localStorage.setItem(
            "@paseo:app-settings",
            JSON.stringify({ toolCallDetailLevel: "detailed" }),
          );
        });
        await openAgentRoute(page, agent);
        await expectComposerVisible(page);
        await installSemanticFailure(page, agent.agentId);
        await page.reload();
        await expectComposerVisible(page);
        await agent.client.sendAgentMessage(
          agent.agentId,
          "Exercise semantic tool failure display.",
        );
        const badge = page
          .getByTestId("tool-call-badge")
          .filter({ hasText: "Running Progress Checkpoint" })
          .first();
        await expect(badge).toBeVisible({ timeout: 30000 });
        await badge.click();
        const diagnostic = page.getByText(reason, { exact: false });
        await expect(diagnostic).toHaveCount(1);
        await expect(diagnostic).toBeInViewport();
        await expect(page.getByText('"message"', { exact: false })).toHaveCount(0);
        const screenshot = testInfo.outputPath(`tool-failure-${viewport.width}.png`);
        if (viewport.width < 600) {
          await expect(page.getByTestId("tool-call-sheet-close")).toBeVisible();
          await page.screenshot({ path: screenshot });
        } else {
          await badge.screenshot({ path: screenshot });
        }
        await testInfo.attach(`tool-failure-${viewport.width}`, {
          path: screenshot,
          contentType: "image/png",
        });
      } finally {
        await agent.cleanup();
      }
    });
  });
}
