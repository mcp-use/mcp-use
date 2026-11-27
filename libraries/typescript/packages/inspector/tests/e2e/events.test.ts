/**
 * MCP Events tab E2E tests.
 *
 * This file starts two events fixture servers (see fixtures/events-server.ts):
 * - :3010 behaves like `mcp-use dev`: insecure callbacks allowed, so the
 *   Inspector can subscribe its http://localhost webhook inbox while signed out.
 * - :3011 behaves like a deployed server: webhook subscriptions need sign-in,
 *   so the Inspector shows its sign-in notice and offers Poll instead.
 *
 * Both modes of the inspector (standalone at :3000 and built-in under /mcp)
 * connect to them by URL. The fixtures use fixed ports, so this file runs in a
 * single worker.
 */

import { expect, test, type Page } from "@playwright/test";
import { createEventsServer } from "./fixtures/events-server";
import { tabLocator } from "./helpers/connection";
import { getTestMatrix } from "./helpers/test-matrix";

test.describe.configure({ mode: "default" });

const devServer = createEventsServer({
  port: 3010,
  allowInsecureCallbacks: true,
});
const strictServer = createEventsServer({
  port: 3011,
  allowInsecureCallbacks: false,
});

test.beforeAll(async () => {
  await devServer.listen();
  await strictServer.listen();
});

test.afterAll(async () => {
  await devServer.close();
  await strictServer.close();
});

test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.goto(getTestMatrix().inspectorUrl);
  await page.evaluate(() => localStorage.clear());
});

/** Open the Inspector auto-connected to `serverUrl` and wait for its tools. */
async function connect(page: Page, serverUrl: string, firstTool: string) {
  const { inspectorUrl } = getTestMatrix();
  await page.goto(
    `${inspectorUrl}?autoConnect=${encodeURIComponent(serverUrl)}`
  );
  await expect(page.getByRole("heading", { name: "Tools" })).toBeVisible();
  await expect(page.getByTestId(`tool-item-${firstTool}`)).toBeVisible();
}

/** Open the Events tab and select `note.created`. */
async function selectNoteCreated(page: Page) {
  await tabLocator(page, "events").click();
  await expect(page.getByTestId("events-tab-title")).toBeVisible();
  await page.getByTestId("event-item-note.created").click();
  await expect(page.getByTestId("event-detail-title")).toHaveText(
    "note.created"
  );
}

/**
 * A tool/event argument input. The Tools and Events tabs stay mounted when
 * hidden and both render `tool-param-<name>`, so keep only the visible one.
 */
function visibleParam(page: Page, name: string) {
  return page.locator(`[data-testid="tool-param-${name}"]:visible`);
}

let noteSeq = 0;
function nextNote(folder = "inbox") {
  noteSeq += 1;
  return {
    folder,
    noteId: `e2e_${Date.now().toString(36)}_${noteSeq}`,
    title: `Note ${noteSeq}`,
  };
}

test.describe("Events tab", () => {
  test("is hidden for a server without MCP Events", async ({ page }) => {
    const { serverUrl } = getTestMatrix();
    await connect(page, serverUrl, "test_simple_text");
    await expect(tabLocator(page, "tools")).toBeVisible();
    await expect(tabLocator(page, "events")).toHaveCount(0);
  });

  test("is shown for an events server and lists its events", async ({
    page,
  }) => {
    await connect(page, devServer.url, "create_note");
    await expect(tabLocator(page, "events")).toBeVisible();
    await tabLocator(page, "events").click();
    await expect(page.getByTestId("events-tab-title")).toBeVisible();
    await expect(
      page.getByText("Select an event to get started")
    ).toBeVisible();

    const item = page.getByTestId("event-item-note.created");
    await expect(item).toBeVisible();
    await expect(item).toContainText("A note was created in a folder");
    await expect(item).toContainText("webhook");
    await expect(item).toContainText("poll");

    await item.click();
    await expect(page.getByTestId("event-detail-title")).toHaveText(
      "note.created"
    );
    await expect(visibleParam(page, "folder")).toBeVisible();
    await expect(
      page.getByText(/Callback: http:\/\/localhost:\d+\//)
    ).toBeVisible();
  });

  test("webhook subscription receives a signed delivery from a tool call, then unsubscribes", async ({
    page,
  }) => {
    await connect(page, devServer.url, "create_note");
    await selectNoteCreated(page);
    await expect(page.getByText(/Callback: http/)).toBeVisible();
    await page.getByTestId("event-subscribe-button").click();

    const sub = page.getByTestId("events-subscription");
    await expect(sub).toHaveCount(1);
    await expect(sub).toContainText("note.created");
    await expect(sub).toContainText("webhook");
    await expect(page.getByTestId("events-auth-notice")).toHaveCount(0);

    // The server verifies the callback with a signed challenge first.
    const verification = sub
      .getByTestId("events-delivery-row")
      .filter({ hasText: "verification" });
    await expect(verification).toContainText("signature ok", {
      timeout: 15_000,
    });

    // Call the tool that emits note.created.
    await tabLocator(page, "tools").click();
    await page.getByTestId("tool-item-create_note").click();
    await visibleParam(page, "folder").fill("inbox");
    await visibleParam(page, "title").fill("From the tools tab");
    await page.getByTestId("tool-execution-execute-button").click();
    await expect(
      page.getByTestId("tool-execution-results-text-content")
    ).toContainText("Created note_");

    await tabLocator(page, "events").click();
    const delivery = sub
      .getByTestId("events-delivery-row")
      .filter({ hasText: "note.created" });
    await expect(delivery).toHaveCount(1, { timeout: 15_000 });
    await expect(delivery).toContainText("signature ok");
    await delivery.click();
    await expect(sub).toContainText("webhook-signature");
    await expect(sub).toContainText("From the tools tab");

    await sub.getByTestId("events-unsubscribe-button").click();
    await expect(page.getByTestId("events-subscription")).toHaveCount(0);
    await expect(page.getByText(/No subscriptions yet/)).toBeVisible();
  });

  test("poll subscription receives an emitted event", async ({ page }) => {
    await connect(page, devServer.url, "create_note");
    await selectNoteCreated(page);
    await page.getByTestId("events-toggle-poll").click();
    await expect(
      page.getByText("The Inspector calls events/poll every 3 seconds.")
    ).toBeVisible();
    await page.getByTestId("event-subscribe-button").click();

    const sub = page.getByTestId("events-subscription");
    await expect(sub).toHaveCount(1);
    await expect(sub).toContainText("poll");

    const note = nextNote();
    await devServer.emit(note);
    await expect(
      sub.getByTestId("events-delivery-row").filter({ hasText: note.noteId })
    ).toHaveCount(1, { timeout: 15_000 });

    await sub.getByTestId("events-unsubscribe-button").click();
    await expect(page.getByTestId("events-subscription")).toHaveCount(0);
  });

  test("webhook needs sign-in on a non-dev server; Use Poll subscribes by polling", async ({
    page,
  }) => {
    await connect(page, strictServer.url, "create_note");
    await selectNoteCreated(page);
    await page.getByTestId("event-subscribe-button").click();

    const notice = page.getByTestId("events-auth-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Webhook subscription needs sign-in");
    await expect(notice).toContainText("Use Poll delivery instead");
    await expect(page.getByTestId("events-subscription")).toHaveCount(0);

    await page.getByTestId("events-auth-use-poll").click();
    await expect(notice).toHaveCount(0);
    const sub = page.getByTestId("events-subscription");
    await expect(sub).toHaveCount(1);
    await expect(sub).toContainText("poll");

    const note = nextNote();
    await strictServer.emit(note);
    await expect(
      sub.getByTestId("events-delivery-row").filter({ hasText: note.noteId })
    ).toHaveCount(1, { timeout: 15_000 });
  });
});
