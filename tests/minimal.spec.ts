import { expect, test, type Page } from "@playwright/test";
import { boardItem, bounds, imageFile, importImages } from "./fixtures";

const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), "No uncaught browser errors").toEqual([]);
});

const contextMenu = (page: Page) => page.locator("#context-menu");
const command = (page: Page, name: string) =>
  contextMenu(page).getByRole("menuitem", { name, exact: true });

async function openContextMenu(page: Page, point = { x: 70, y: 150 }) {
  await page.getByTestId("canvas").click({ button: "right", position: point });
  await expect(contextMenu(page)).toBeVisible();
}

test("starts with an edge-to-edge canvas and hidden optional controls", async ({
  page,
}) => {
  for (const selector of [
    ".topbar",
    "footer",
    ".bottom-controls",
    "#selection-tools",
  ])
    await expect(page.locator(selector)).not.toBeVisible();
  const canvas = await bounds(page.getByTestId("canvas"));
  expect(canvas.x).toBe(0);
  expect(canvas.y).toBe(0);
  expect(canvas.width).toBe(page.viewportSize()!.width);
  expect(canvas.height).toBe(page.viewportSize()!.height);
  await expect(
    page.getByRole("button", { name: "Import images", exact: true }),
  ).toBeVisible();
  await importImages(page);
  await expect(page.getByTestId("board-item")).toBeVisible();
  await expect(page.locator("#selection-tools")).not.toBeVisible();
  await expect(page.locator(".bottom-controls")).not.toBeVisible();
});

test("right-click exposes board actions without restoring the full interface", async ({
  page,
}) => {
  await openContextMenu(page);
  for (const name of [
    "Import images",
    "Add note",
    "Open board",
    "Save board",
    "New board",
    "Undo",
    "Redo",
    "Fit all",
    "Reset zoom",
    "Show controls",
    "Keyboard shortcuts",
  ])
    await expect(command(page, name)).toBeVisible();
  await expect(command(page, "Undo")).toBeDisabled();
  await expect(command(page, "Redo")).toBeDisabled();
  await expect(page.locator(".topbar")).not.toBeVisible();
  await expect(command(page, "Duplicate")).toHaveCount(0);
});

test("imports images and adds notes through the contextual tools", async ({
  page,
}) => {
  await openContextMenu(page);
  const chooser = page.waitForEvent("filechooser");
  await command(page, "Import images").click();
  await (await chooser).setFiles(imageFile("context-reference.png"));
  await expect(boardItem(page, "context-reference.png")).toBeVisible();
  await expect(contextMenu(page)).not.toBeVisible();
  await openContextMenu(page);
  await command(page, "Add note").click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Keep the canvas quiet.");
  await page
    .getByRole("button", { name: "Done editing note", exact: true })
    .click();
  await expect(page.getByTestId("board-item")).toHaveCount(2);
  await expect(page.locator(".topbar")).not.toBeVisible();
});

test("right-click selects an image and exposes its editing actions", async ({
  page,
}) => {
  await importImages(page, ["one.png", "two.png"]);
  await page.keyboard.press("Escape");
  await boardItem(page, "one.png").click({
    button: "right",
    position: { x: 10, y: 10 },
  });
  await expect(boardItem(page, "one.png")).toHaveClass(/selected/);
  await expect(page.locator(".board-item.selected")).toHaveCount(1);
  for (const name of [
    "Duplicate",
    "Delete",
    "Arrange",
    "Rotate left",
    "Rotate right",
    "Lock selection",
    "Bring to front",
    "Send to back",
  ])
    await expect(command(page, name)).toBeVisible();
  await command(page, "Duplicate").click();
  await expect(page.getByTestId("board-item")).toHaveCount(3);
  const copy = page.locator(".board-item.selected");
  await copy.click({ button: "right" });
  await command(page, "Delete").click();
  await expect(page.getByTestId("board-item")).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("board-item")).toHaveCount(3);
});

test("Show controls reveals the optional layout and Tab restores the minimal canvas", async ({
  page,
}) => {
  await openContextMenu(page);
  await command(page, "Show controls").click();
  for (const selector of [".topbar", "footer", ".bottom-controls"])
    await expect(page.locator(selector)).toBeVisible();
  await expect(contextMenu(page)).not.toBeVisible();
  await openContextMenu(page);
  await expect(command(page, "Hide controls")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".topbar")).not.toBeVisible();
  await expect(page.locator(".bottom-controls")).not.toBeVisible();
});

test("context menus dismiss on an outside click and Escape", async ({
  page,
}) => {
  await openContextMenu(page);
  await page.getByTestId("canvas").click({ position: { x: 20, y: 20 } });
  await expect(contextMenu(page)).not.toBeVisible();
  await openContextMenu(page);
  await page.keyboard.press("Escape");
  await expect(contextMenu(page)).not.toBeVisible();
  await expect(page.getByTestId("canvas")).toBeFocused();
});

test("Shift+F10 opens contextual tools and arrows navigate available actions", async ({
  page,
}) => {
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("Shift+F10");
  await expect(contextMenu(page)).toBeVisible();
  await expect(command(page, "Import images")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(command(page, "Add note")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(command(page, "Import images")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".note-editor")).toBeFocused();
  await expect(contextMenu(page)).not.toBeVisible();
});

test("board and selection menus remain inside a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await openContextMenu(page, { x: 311, y: 471 });
  await expect(contextMenu(page)).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await importImages(page);
  await boardItem(page).click({ button: "right" });
  await expect(contextMenu(page)).toBeInViewport({ ratio: 1 });
  await command(page, "Delete").click();
  await expect(page.getByTestId("board-item")).toHaveCount(0);
});

test("Space activates a focused contextual tool without starting canvas panning", async ({
  page,
}) => {
  const canvas = page.getByTestId("canvas");
  await canvas.focus();
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("ArrowDown");
  await expect(command(page, "Add note")).toBeFocused();
  await page.keyboard.down("Space");
  await expect(canvas).not.toHaveClass(/space-pan|panning/);
  await page.keyboard.up("Space");
  await expect(page.locator(".note-editor")).toBeFocused();
  await expect(contextMenu(page)).not.toBeVisible();
  await page.keyboard.press("Escape");
  await expect(canvas).not.toHaveClass(/space-pan|panning/);
});

test("contextual file actions save, replace, reopen, and restore the board", async ({
  page,
}) => {
  await importImages(page);
  await openContextMenu(page);
  const downloadEvent = page.waitForEvent("download");
  await command(page, "Save board").click();
  const stream = await (await downloadEvent).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const saved = Buffer.concat(chunks);
  await openContextMenu(page);
  await command(page, "New board").click();
  await page
    .locator("#confirm-dialog")
    .getByRole("button", { name: "New board", exact: true })
    .click();
  await expect(page.getByTestId("board-item")).toHaveCount(0);
  await openContextMenu(page);
  const chooser = page.waitForEvent("filechooser");
  await command(page, "Open board").click();
  await (
    await chooser
  ).setFiles({
    name: "saved.mindboard",
    mimeType: "application/json",
    buffer: saved,
  });
  await expect(boardItem(page)).toBeVisible();
  await openContextMenu(page);
  await command(page, "Undo").click();
  await expect(page.getByTestId("board-item")).toHaveCount(0);
  await openContextMenu(page);
  await command(page, "Redo").click();
  await expect(boardItem(page)).toBeVisible();
  await openContextMenu(page);
  await command(page, "Keyboard shortcuts").click();
  await expect(page.locator("#help-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".topbar")).not.toBeVisible();
});

test("contextual rotation, locking and view commands work on the minimal canvas", async ({
  page,
}) => {
  await importImages(page);
  const item = boardItem(page);
  const original = await bounds(item);
  await item.click({ button: "right" });
  await command(page, "Rotate right").click();
  expect((await bounds(item)).width).toBeCloseTo(original.height, 0);
  await item.click({ button: "right" });
  await command(page, "Rotate left").click();
  expect((await bounds(item)).width).toBeCloseTo(original.width, 0);
  await item.click({ button: "right" });
  await command(page, "Lock selection").click();
  await expect(item).toHaveClass(/locked/);
  await item.click({ button: "right" });
  await expect(command(page, "Delete")).toBeDisabled();
  await command(page, "Unlock selection").click();
  await expect(item).not.toHaveClass(/locked/);
  await page.mouse.move(
    original.x + original.width / 2,
    original.y + original.height / 2,
  );
  await page.mouse.wheel(0, -120);
  await expect
    .poll(async () => (await bounds(item)).width)
    .toBeGreaterThan(original.width);
  await openContextMenu(page);
  await command(page, "Reset zoom").click();
  expect((await bounds(item)).width).toBeCloseTo(original.width, 0);
  await openContextMenu(page);
  await command(page, "Fit all").click();
  await expect(item).toBeInViewport({ ratio: 1 });
});

test("Original pixels is only available for one selected image", async ({
  page,
}) => {
  const assertUnavailable = async () => {
    const action = command(page, "Original pixels");
    if (await action.count()) await expect(action).toBeDisabled();
  };
  await openContextMenu(page);
  await assertUnavailable();
  await page.keyboard.press("Escape");
  await page.keyboard.press("n");
  await page
    .getByRole("textbox", { name: "Note text", exact: true })
    .fill("A note has no source image pixels");
  await page.keyboard.press("Control+Enter");
  await page.locator(".board-item.note").click({ button: "right" });
  await assertUnavailable();
  await page.keyboard.press("Escape");
  await importImages(page, ["one.png", "two.png"]);
  await boardItem(page, "two.png").click({ button: "right" });
  await expect(page.locator(".board-item.selected")).toHaveCount(2);
  await assertUnavailable();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await boardItem(page, "two.png").click({ button: "right" });
  await expect(page.locator(".board-item.selected")).toHaveCount(1);
  await expect(command(page, "Original pixels")).toBeEnabled();
});
