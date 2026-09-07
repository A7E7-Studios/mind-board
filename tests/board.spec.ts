import { expect, test, type Page } from "@playwright/test";
import {
  boardItem,
  bounds,
  drag,
  imageFile,
  importImages,
  openBoard,
  showControls,
} from "./fixtures";

const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("canvas")).toBeVisible();
  await showControls(page);
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), "No uncaught browser errors").toEqual([]);
});

test("starts with a clear empty board and imports several actual image files", async ({
  page,
}) => {
  await expect(page.getByTestId("board-item")).toHaveCount(0);
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Import images", exact: true })
    .click();
  await (
    await chooser
  ).setFiles([
    imageFile("landscape.png"),
    imageFile("palette.png", [200, 100, 80]),
  ]);
  await expect(page.getByTestId("board-item")).toHaveCount(2);
  for (const name of ["landscape.png", "palette.png"]) {
    await expect(boardItem(page, name)).toBeVisible();
    await expect(boardItem(page, name).locator("img")).toHaveJSProperty(
      "naturalWidth",
      240,
    );
  }
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeEnabled();
});

test("imports dropped image files onto the canvas", async ({ page }) => {
  const fixture = imageFile("dropped.png");
  const dataTransfer = await page.evaluateHandle(
    ({ bytes, name }) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], name, { type: "image/png" }),
      );
      return transfer;
    },
    { bytes: [...fixture.buffer], name: fixture.name },
  );
  await page
    .getByTestId("canvas")
    .dispatchEvent("drop", { dataTransfer, clientX: 500, clientY: 350 });
  await expect(boardItem(page, "dropped.png")).toBeVisible();
});

test("selects, moves, and proportionally resizes an image; gestures undo atomically", async ({
  page,
}) => {
  await importImages(page);
  const item = boardItem(page);
  await item.click();
  await expect(item).toHaveClass(/selected/);
  const start = await bounds(item);
  await drag(
    page,
    { x: start.x + start.width / 2, y: start.y + start.height / 2 },
    { x: start.x + start.width / 2 + 90, y: start.y + start.height / 2 + 55 },
  );
  const moved = await bounds(item);
  expect(moved.x - start.x).toBeCloseTo(90, 0);
  expect(moved.y - start.y).toBeCloseTo(55, 0);
  await page.keyboard.press("Control+z");
  expect((await bounds(item)).x).toBeCloseTo(start.x, 0);
  await page.keyboard.press("Control+Shift+z");
  expect((await bounds(item)).x).toBeCloseTo(moved.x, 0);
  await item.click();
  const handle = item.getByTestId("resize-handle");
  const handleBox = await bounds(handle);
  await drag(
    page,
    {
      x: handleBox.x + handleBox.width / 2,
      y: handleBox.y + handleBox.height / 2,
    },
    {
      x: handleBox.x + handleBox.width / 2 + 90,
      y: handleBox.y + handleBox.height / 2 + 60,
    },
  );
  const resized = await bounds(item);
  expect(resized.width).toBeGreaterThan(moved.width + 30);
  expect(resized.width / resized.height).toBeCloseTo(
    moved.width / moved.height,
    1,
  );
  await page.keyboard.press("Control+z");
  expect((await bounds(item)).width).toBeCloseTo(moved.width, 0);
});

test("supports multi-selection, group movement, duplication and deletion with undo", async ({
  page,
}) => {
  await importImages(page, ["one.png", "two.png"]);
  await page.keyboard.press("Escape");
  await boardItem(page, "one.png").click({ position: { x: 10, y: 10 } });
  await boardItem(page, "two.png").click({ modifiers: ["Shift"] });
  await expect(page.locator(".board-item.selected")).toHaveCount(2);
  const first = await bounds(boardItem(page, "one.png"));
  const second = await bounds(boardItem(page, "two.png"));
  await drag(
    page,
    { x: first.x + 40, y: first.y + 40 },
    { x: first.x + 90, y: first.y + 70 },
  );
  expect((await bounds(boardItem(page, "two.png"))).x - second.x).toBeCloseTo(
    50,
    0,
  );
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.getByTestId("board-item")).toHaveCount(4);
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("board-item")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("board-item")).toHaveCount(4);
  await page.keyboard.press("Control+a");
  await expect(page.locator(".board-item.selected")).toHaveCount(4);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("board-item")).toHaveCount(0);
});

test("pans with middle drag and Space drag, zooms, resets and fits images", async ({
  page,
}) => {
  await importImages(page);
  const item = boardItem(page);
  const start = await bounds(item);
  const point = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(point.x + 70, point.y + 30, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  expect((await bounds(item)).x - start.x).toBeCloseTo(70, 0);
  const middle = await bounds(item);
  await page.keyboard.down("Space");
  await drag(
    page,
    { x: middle.x + 30, y: middle.y + 30 },
    { x: middle.x - 20, y: middle.y + 10 },
  );
  await page.keyboard.up("Space");
  expect((await bounds(item)).x - middle.x).toBeCloseTo(-50, 0);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  expect((await bounds(item)).width).toBeGreaterThan(start.width);
  await page.getByRole("button", { name: "Reset zoom", exact: true }).click();
  expect((await bounds(item)).width).toBeCloseTo(240, 0);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  expect((await bounds(item)).width).toBeLessThan(240);
  await page.keyboard.press("1");
  expect((await bounds(item)).width).toBeCloseTo(240, 0);
  await page.getByRole("button", { name: "Fit all", exact: true }).click();
  const fitted = await bounds(item);
  const canvas = await bounds(page.getByTestId("canvas"));
  expect(fitted.x).toBeGreaterThanOrEqual(canvas.x);
  expect(fitted.y).toBeGreaterThanOrEqual(canvas.y);
  expect(fitted.x + fitted.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(fitted.y + fitted.height).toBeLessThanOrEqual(
    canvas.y + canvas.height,
  );
});

test("creates and edits notes without treating text input as canvas shortcuts", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Note text" });
  await expect(editor).toBeFocused();
  await editor.fill("Look for warm light and simple shapes.");
  await page
    .getByRole("button", { name: "Done editing note", exact: true })
    .click();
  await expect(page.getByTestId("board-item")).toHaveCount(1);
  await expect(page.getByTestId("board-item")).toContainText(
    "Look for warm light",
  );
  await page.getByTestId("board-item").dblclick();
  await editor.fill("Updated reference notes");
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("Final notes");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("board-item")).toContainText("Final notes");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("board-item")).toContainText(
    "Look for warm light",
  );
});

test("renames boards, saves portable contents, and opens the saved board", async ({
  page,
}) => {
  await importImages(page, ["saved-reference.png"]);
  await page
    .getByRole("textbox", { name: "Board name" })
    .fill("Studio references");
  await page.getByRole("textbox", { name: "Board name" }).blur();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save board", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.mindboard$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const saved = Buffer.concat(chunks);
  expect(saved.toString()).toContain("data:image/png;base64,");
  expect(JSON.parse(saved.toString()).name).toBe("Studio references");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("board-item")).toHaveCount(0);
  await openBoard(page, {
    name: "Studio references.mindboard",
    mimeType: "application/json",
    buffer: saved,
  });
  await expect(boardItem(page, "saved-reference.png")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Board name" })).toHaveValue(
    "Studio references",
  );
});

test("recovers the board and its name after a browser reload", async ({
  page,
}) => {
  await importImages(page, ["recovered.png"]);
  await page
    .getByRole("textbox", { name: "Board name" })
    .fill("Recovered study");
  await page.getByRole("textbox", { name: "Board name" }).blur();
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await page.reload();
  await showControls(page);
  await expect(boardItem(page, "recovered.png")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Board name" })).toHaveValue(
    "Recovered study",
  );
});

test("rejects corrupt boards without replacing the current document", async ({
  page,
}) => {
  await importImages(page, ["keep-me.png"]);
  await openBoard(page, {
    name: "broken.mindboard",
    mimeType: "application/json",
    buffer: Buffer.from("{invalid json"),
  });
  await expect(boardItem(page, "keep-me.png")).toBeVisible();
  await expect(page.locator("#toast")).toContainText("Could not open board");
});

test("rejects invalid image bytes and keeps valid references intact", async ({
  page,
}) => {
  await importImages(page, ["keep-me.png"]);
  await page.locator("#image-input").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.locator("#toast")).toContainText("could not be decoded");
  await expect(page.getByTestId("board-item")).toHaveCount(1);
  await expect(boardItem(page, "keep-me.png")).toBeVisible();
});

test("shows keyboard help and dismisses dialogs with Escape", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Undo");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("board-item")).toHaveCount(0);
});

test("pastes a clipboard image and can undo the paste", async ({ page }) => {
  const fixture = imageFile("clipboard.png");
  await page.evaluate(
    ({ bytes, name }) => {
      const clipboard = new DataTransfer();
      clipboard.items.add(
        new File([new Uint8Array(bytes)], name, { type: "image/png" }),
      );
      document.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: clipboard,
          bubbles: true,
        }),
      );
    },
    { bytes: [...fixture.buffer], name: fixture.name },
  );
  await expect(page.getByTestId("board-item")).toHaveCount(1);
  await expect(page.getByTestId("board-item").locator("img")).toHaveJSProperty(
    "naturalWidth",
    240,
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("board-item")).toHaveCount(0);
});

test("decodes JPEG, WebP and GIF files through the real browser importer", async ({
  page,
}) => {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 32;
    canvas.getContext("2d")!.fillRect(0, 0, 48, 32);
    return ["image/jpeg", "image/webp"].map((type) => ({
      type,
      url: canvas.toDataURL(type),
    }));
  });
  const files = encoded.map(({ type, url }) => ({
    name: `reference.${type.split("/")[1]}`,
    mimeType: type,
    buffer: Buffer.from(url.split(",")[1], "base64"),
  }));
  files.push({
    name: "reference.gif",
    mimeType: "image/gif",
    buffer: Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    ),
  });
  await page.locator("#image-input").setInputFiles(files);
  await expect(page.getByTestId("board-item")).toHaveCount(3);
  for (const name of ["reference.jpeg", "reference.webp", "reference.gif"]) {
    await expect(boardItem(page, name).locator("img")).toHaveJSProperty(
      "complete",
      true,
    );
    expect(
      await boardItem(page, name)
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBeGreaterThan(0);
  }
});

test("locks a selected image against movement and unlocks it again", async ({
  page,
}) => {
  await importImages(page);
  const item = boardItem(page);
  await item.click();
  await page
    .getByRole("button", { name: "Lock selection", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Lock selection", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(item.getByTestId("resize-handle")).toHaveCount(0);
  const locked = await bounds(item);
  await drag(
    page,
    { x: locked.x + 50, y: locked.y + 50 },
    { x: locked.x + 130, y: locked.y + 100 },
  );
  expect((await bounds(item)).x).toBeCloseTo(locked.x, 0);
  expect((await bounds(item)).y).toBeCloseTo(locked.y, 0);
  await page
    .getByRole("button", { name: "Lock selection", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Lock selection", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(item.getByTestId("resize-handle")).toBeVisible();
  await drag(
    page,
    { x: locked.x + 50, y: locked.y + 50 },
    { x: locked.x + 130, y: locked.y + 100 },
  );
  expect((await bounds(item)).x - locked.x).toBeCloseTo(80, 0);
});

test("rotates selected images in both directions and restores them with undo", async ({
  page,
}) => {
  await importImages(page);
  const item = boardItem(page);
  await item.click();
  const original = await bounds(item);
  await page.getByRole("button", { name: "Rotate right", exact: true }).click();
  const rotated = await bounds(item);
  expect(rotated.width).toBeCloseTo(original.height, 0);
  expect(rotated.height).toBeCloseTo(original.width, 0);
  await page.getByRole("button", { name: "Rotate left", exact: true }).click();
  expect((await bounds(item)).width).toBeCloseTo(original.width, 0);
  await page.keyboard.press("Control+z");
  expect((await bounds(item)).width).toBeCloseTo(rotated.width, 0);
});

test("arranges references without overlaps and can undo the arrangement", async ({
  page,
}) => {
  await importImages(page, ["one.png", "two.png", "three.png"]);
  const item = boardItem(page, "one.png");
  await page.keyboard.press("Escape");
  await item.click({ position: { x: 10, y: 10 } });
  const start = await bounds(item);
  await drag(
    page,
    { x: start.x + 10, y: start.y + 10 },
    { x: start.x + 100, y: start.y + 65 },
  );
  const moved = await bounds(item);
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  const boxes = await Promise.all(
    ["one.png", "two.png", "three.png"].map((name) =>
      bounds(boardItem(page, name)),
    ),
  );
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const first = boxes[a],
        second = boxes[b];
      const overlap =
        first.x < second.x + second.width &&
        first.x + first.width > second.x &&
        first.y < second.y + second.height &&
        first.y + first.height > second.y;
      expect(overlap).toBe(false);
    }
  }
  await page.keyboard.press("Control+z");
  expect((await bounds(item)).x).toBeCloseTo(moved.x, 0);
  expect((await bounds(item)).y).toBeCloseTo(moved.y, 0);
});

test("changes image stacking order with front and back commands", async ({
  page,
}) => {
  await importImages(page, ["one.png", "two.png"]);
  await page.keyboard.press("Escape");
  await boardItem(page, "one.png").click({ position: { x: 10, y: 10 } });
  const first = await bounds(boardItem(page, "one.png"));
  const second = await bounds(boardItem(page, "two.png"));
  await drag(
    page,
    { x: first.x + 10, y: first.y + 10 },
    { x: second.x + 10, y: second.y + 10 },
  );
  await page
    .getByRole("button", { name: "Bring to front", exact: true })
    .click();
  const overlappingPoint = { x: second.x + 60, y: second.y + 60 };
  const topImage = () =>
    page.evaluate(
      (point) =>
        document
          .elementFromPoint(point.x, point.y)
          ?.closest(".board-item")
          ?.getAttribute("aria-label"),
      overlappingPoint,
    );
  expect(await topImage()).toBe("one.png");
  await page.getByRole("button", { name: "Send to back", exact: true }).click();
  expect(await topImage()).toBe("two.png");
  await page.keyboard.press("Control+z");
  expect(await topImage()).toBe("one.png");
});

test("zooms around the wheel pointer and preserves the image point under it", async ({
  page,
}) => {
  await importImages(page);
  const item = boardItem(page);
  const start = await bounds(item);
  const center = {
    x: start.x + start.width / 2,
    y: start.y + start.height / 2,
  };
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -120);
  await expect
    .poll(async () => (await bounds(item)).width)
    .toBeGreaterThan(start.width);
  const zoomed = await bounds(item);
  expect(zoomed.x + zoomed.width / 2).toBeCloseTo(center.x, 0);
  expect(zoomed.y + zoomed.height / 2).toBeCloseTo(center.y, 0);
});

test("focus mode hides controls and returns through its keyboard shortcut", async ({
  page,
}) => {
  await importImages(page);
  await page.getByRole("button", { name: "Board menu", exact: true }).click();
  await page.getByRole("button", { name: /^Focus mode/ }).click();
  await expect(
    page.getByRole("button", { name: "Import images", exact: true }),
  ).not.toBeVisible();
  await expect(boardItem(page)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Import images", exact: true }),
  ).toBeVisible();
});

test("new board starts a clean document", async ({ page }) => {
  await importImages(page);
  await page.getByRole("button", { name: "Board menu", exact: true }).click();
  await page
    .locator("#board-menu")
    .getByRole("button", { name: /^New board/ })
    .click();
  await page
    .locator("#confirm-dialog")
    .getByRole("button", { name: "New board", exact: true })
    .click();
  await expect(page.getByTestId("board-item")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Board name" })).toHaveValue(
    "Untitled board",
  );
});

test("marquee selects images, Escape deselects, and duplicate has a keyboard shortcut", async ({
  page,
}) => {
  await importImages(page, ["one.png", "two.png"]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".board-item.selected")).toHaveCount(0);
  const first = await bounds(boardItem(page, "one.png"));
  const second = await bounds(boardItem(page, "two.png"));
  await drag(
    page,
    {
      x: Math.min(first.x, second.x) - 15,
      y: Math.min(first.y, second.y) - 15,
    },
    {
      x: Math.max(first.x + first.width, second.x + second.width) + 15,
      y: Math.max(first.y + first.height, second.y + second.height) + 15,
    },
  );
  await expect(page.locator(".board-item.selected")).toHaveCount(2);
  await page.keyboard.press("Control+d");
  await expect(page.getByTestId("board-item")).toHaveCount(4);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("board-item")).toHaveCount(2);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("board-item")).toHaveCount(4);
});

test("fullscreen can be entered and exited through the board menu", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Board menu", exact: true }).click();
  await page.getByRole("button", { name: /^Fullscreen/ }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await page.getByRole("button", { name: "Board menu", exact: true }).click();
  await page
    .getByRole("button", { name: /^(Exit fullscreen|Fullscreen)/ })
    .click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
});

test("pointer cancellation restores geometry without adding an undo entry", async ({
  page,
}) => {
  await importImages(page);
  const item = boardItem(page);
  const start = await bounds(item);
  await page.mouse.move(start.x + 50, start.y + 50);
  await page.mouse.down();
  await page.mouse.move(start.x + 130, start.y + 100, { steps: 5 });
  expect((await bounds(item)).x).toBeCloseTo(start.x + 80, 0);
  await page
    .getByTestId("canvas")
    .dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
  await page.mouse.up();
  expect((await bounds(item)).x).toBeCloseTo(start.x, 0);
  expect((await bounds(item)).y).toBeCloseTo(start.y, 0);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("board-item")).toHaveCount(0);
});

test("deleting during a drag does not resurrect the reference on pointer release", async ({
  page,
}) => {
  await importImages(page);
  const start = await bounds(boardItem(page));
  await page.mouse.move(start.x + 50, start.y + 50);
  await page.mouse.down();
  await page.mouse.move(start.x + 130, start.y + 100, { steps: 5 });
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("board-item")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByTestId("board-item")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("board-item")).toHaveCount(1);
});

test("importing while dragging preserves both the completed move and the new image", async ({
  page,
}) => {
  await importImages(page);
  const start = await bounds(boardItem(page));
  await page.mouse.move(start.x + 50, start.y + 50);
  await page.mouse.down();
  await page.mouse.move(start.x + 130, start.y + 100, { steps: 5 });
  await importImages(page, ["added-mid-gesture.png"]);
  await page.mouse.up();
  await expect(page.getByTestId("board-item")).toHaveCount(2);
  expect((await bounds(boardItem(page))).x).toBeCloseTo(start.x + 80, 0);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("board-item")).toHaveCount(1);
  expect((await bounds(boardItem(page))).x).toBeCloseTo(start.x + 80, 0);
});

test("very thin images remain valid across saving and recovery", async ({
  page,
}) => {
  await page
    .locator("#image-input")
    .setInputFiles(imageFile("thin.png", [100, 150, 180], 1, 1000));
  await expect(page.getByTestId("board-item")).toHaveCount(1);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  const downloadEvent = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.mindboard$/);
  await page.reload();
  await showControls(page);
  await expect(boardItem(page, "thin.png")).toBeVisible();
  await expect(boardItem(page, "thin.png").locator("img")).toHaveJSProperty(
    "naturalHeight",
    1000,
  );
});

test("editing the board name does not trigger destructive canvas shortcuts", async ({
  page,
}) => {
  await importImages(page);
  const name = page.getByRole("textbox", { name: "Board name" });
  await name.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText("New inspiration");
  await page.keyboard.press("Enter");
  await expect(name).toHaveValue("New inspiration");
  await expect(page.getByTestId("board-item")).toHaveCount(1);
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("a mixed image batch reports rejected files and imports the valid image", async ({
  page,
}) => {
  await page.locator("#image-input").setInputFiles([
    imageFile("valid.png"),
    {
      name: "unsupported.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    },
  ]);
  await expect(boardItem(page, "valid.png")).toBeVisible();
  await expect(page.getByTestId("board-item")).toHaveCount(1);
  await expect(page.locator("#toast")).toContainText("unsupported.svg");
});

test("cancelling New board preserves references and history", async ({
  page,
}) => {
  await importImages(page);
  await page.keyboard.press("Control+n");
  await expect(page.locator("#confirm-dialog")).toBeVisible();
  await page
    .locator("#confirm-dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(boardItem(page)).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("board-item")).toHaveCount(0);
});

test("opening boards with reused item IDs updates image contents and item kinds", async ({
  page,
}) => {
  const first = imageFile("original.png");
  const second = imageFile("replacement.png", [190, 90, 100], 120, 300);
  const common = {
    id: "shared-reference",
    x: 0,
    y: 0,
    width: 240,
    height: 160,
    rotation: 0,
    locked: false,
  };
  const load = async (item: object) =>
    openBoard(page, {
      name: "variant.mindboard",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ version: 1, name: "Variant", items: [item] }),
      ),
    });
  await load({
    ...common,
    kind: "image",
    name: first.name,
    src: `data:image/png;base64,${first.buffer.toString("base64")}`,
  });
  await expect(page.getByTestId("board-item").locator("img")).toHaveJSProperty(
    "naturalWidth",
    240,
  );
  await load({
    ...common,
    kind: "image",
    name: second.name,
    src: `data:image/png;base64,${second.buffer.toString("base64")}`,
  });
  await expect(boardItem(page, second.name).locator("img")).toHaveJSProperty(
    "naturalWidth",
    120,
  );
  await expect(boardItem(page, second.name).locator("img")).toHaveJSProperty(
    "naturalHeight",
    300,
  );
  await load({
    ...common,
    kind: "note",
    name: "Converted note",
    text: "New context for this reference",
  });
  await expect(boardItem(page, "Converted note")).toContainText(
    "New context for this reference",
  );
  await expect(page.getByTestId("board-item").locator("img")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(boardItem(page, second.name).locator("img")).toHaveJSProperty(
    "naturalWidth",
    120,
  );
});

test("the app remains usable when local recovery storage is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      value: {
        open() {
          throw new DOMException("Storage unavailable", "SecurityError");
        },
      },
    });
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  await showControls(page);
  await expect(page.locator("#save-status")).toContainText(
    "Recovery unavailable",
  );
  await importImages(page);
  await expect(boardItem(page)).toBeVisible();
  await expect(page.locator("#save-status")).toContainText(
    "Recovery unavailable",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save board", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.mindboard$/);
});

test("imports an actual AVIF image", async ({ page }) => {
  await page
    .locator("#image-input")
    .setInputFiles("tests/fixtures/reference.avif");
  await expect(page.getByTestId("board-item")).toHaveCount(1);
  await expect(
    boardItem(page, "reference.avif").locator("img"),
  ).toHaveJSProperty("naturalWidth", 240);
  await expect(
    boardItem(page, "reference.avif").locator("img"),
  ).toHaveJSProperty("naturalHeight", 160);
});

for (const width of [320, 640]) {
  test(`keeps essential controls usable in a ${width}px window`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 });
    await importImages(page);
    for (const label of [
      "Open board",
      "Save board",
      "Board menu",
      "Import images",
      "Add note",
      "Zoom in",
      "Zoom out",
      "Fit all",
    ]) {
      await expect(
        page.getByRole("button", { name: label, exact: true }),
      ).toBeInViewport({ ratio: 1 });
    }
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await expect(page.locator(".note-editor")).toBeInViewport({ ratio: 1 });
    await page
      .getByRole("textbox", { name: "Note text" })
      .fill("Small window, same board.");
    await page
      .getByRole("button", { name: "Done editing note", exact: true })
      .click();
    await expect(page.getByTestId("board-item")).toHaveCount(2);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByTestId("board-item")).toHaveCount(1);
  });
}

test("Tab navigates toolbar controls when a control has keyboard focus", async ({
  page,
}) => {
  await importImages(page);
  await page
    .getByRole("button", { name: "Import images", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Add note", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Import images", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".note-editor")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".note-editor")).not.toBeVisible();
});

test("new and edited notes grow to keep their text readable", async ({
  page,
}) => {
  const initial =
    "Design direction\n\nQuiet colors.\nNatural light.\nSimple shapes.\nSoft shadows.\nKeep room to breathe.";
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page.getByRole("textbox", { name: "Note text" }).fill(initial);
  await page
    .getByRole("button", { name: "Done editing note", exact: true })
    .click();
  const note = page.getByTestId("board-item");
  const originalHeight = (await bounds(note)).height;
  expect(originalHeight).toBeGreaterThan(200);
  const fitsText = () =>
    note
      .locator(".item-content")
      .evaluate((element) => element.scrollHeight <= element.clientHeight + 1);
  expect(await fitsText()).toBe(true);
  await note.dblclick();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill(
      `${initial}\n\nExplore warm and cool variations.\nFind three references for each.`,
    );
  await page
    .getByRole("button", { name: "Done editing note", exact: true })
    .click();
  expect((await bounds(note)).height).toBeGreaterThan(originalHeight);
  expect(await fitsText()).toBe(true);
});
