import { expect, test, type Page } from "@playwright/test";
import { bounds, imageFile, importImages, showControls } from "./fixtures";

type SavedNote = {
  id: string;
  kind: string;
  name: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  noteColor?: string;
  noteAlign?: string;
  noteSize?: string;
  noteBold?: boolean;
};
const browserErrors = new WeakMap<Page, string[]>();
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Note text", exact: true });
const note = (page: Page) => page.locator(".board-item.note");
const toolbar = (page: Page) =>
  page.getByRole("toolbar", { name: "Note formatting", exact: true });

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

async function createNote(page: Page, text: string) {
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("n");
  await expect(editor(page)).toBeFocused();
  await editor(page).fill(text);
  await page.keyboard.press("Control+Enter");
  await expect(editor(page)).not.toBeVisible();
}

async function downloadBoard(page: Page) {
  await page.getByTestId("canvas").focus();
  const downloadEvent = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const stream = await (await downloadEvent).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);
  return {
    buffer,
    board: JSON.parse(buffer.toString()) as {
      version: number;
      items: SavedNote[];
    },
  };
}

async function pasteText(page: Page, text: string, html?: string) {
  await page.evaluate(
    ({ text, html }) => {
      const clipboard = new DataTransfer();
      clipboard.setData("text/plain", text);
      if (html) clipboard.setData("text/html", html);
      document.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: clipboard,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { text, html },
  );
}

test("N starts a focused canvas note and commits multiline text as one undoable edit", async ({
  page,
}) => {
  await page.keyboard.press("n");
  await expect(editor(page)).toBeFocused();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(toolbar(page)).toBeVisible();
  await expect(page.locator(".topbar")).not.toBeVisible();
  await page.keyboard.insertText("One clear idea");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("A second line");
  await expect(editor(page)).toHaveValue("One clear idea\nA second line");
  await page.keyboard.press("Control+Enter");
  await expect(editor(page)).not.toBeVisible();
  await expect(note(page)).toContainText("One clear idea\nA second line");
  await page.keyboard.press("Control+z");
  await expect(note(page)).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(note(page)).toContainText("One clear idea\nA second line");
});

test("clicking outside keeps text and empty notes while Escape cancels a new draft", async ({
  page,
}) => {
  await page.keyboard.press("n");
  await editor(page).fill("Saved by clicking the canvas");
  await page.getByTestId("canvas").click({ position: { x: 20, y: 20 } });
  await expect(editor(page)).not.toBeVisible();
  await expect(note(page)).toContainText("Saved by clicking the canvas");
  await page.keyboard.press("n");
  await expect(editor(page)).toBeFocused();
  await page.getByTestId("canvas").click({ position: { x: 20, y: 20 } });
  await expect(editor(page)).not.toBeVisible();
  await expect(note(page)).toHaveCount(2);
  expect((await downloadBoard(page)).board.items[1].text).toBe("");
  await page.keyboard.press("n");
  await editor(page).fill("This draft should be cancelled");
  await page.keyboard.press("Escape");
  await expect(note(page)).toHaveCount(2);
  await expect(note(page).first()).toContainText(
    "Saved by clicking the canvas",
  );
});

test("Done keeps an empty colored note through undo, redo, export, and recovery", async ({
  page,
}) => {
  await page.keyboard.press("n");
  await toolbar(page)
    .getByRole("button", { name: "Sage note", exact: true })
    .click();
  await toolbar(page)
    .getByRole("button", { name: "Done editing note", exact: true })
    .click();
  await expect(editor(page)).not.toBeVisible();
  await expect(note(page)).toHaveCount(1);
  const saved = (await downloadBoard(page)).board.items[0];
  expect(saved).toMatchObject({
    kind: "note",
    name: "Note",
    text: "",
    noteColor: "sage",
  });
  await page.keyboard.press("Control+z");
  await expect(note(page)).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(note(page)).toHaveCount(1);
  expect((await downloadBoard(page)).board.items[0]).toEqual(saved);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  expect((await downloadBoard(page)).board.items[0]).toEqual(saved);
  await page.keyboard.press("n");
  await toolbar(page)
    .getByRole("button", { name: "Rose note", exact: true })
    .click();
  await editor(page).focus();
  await page.keyboard.press("Escape");
  await expect(note(page)).toHaveCount(1);
  expect((await downloadBoard(page)).board.items[0]).toEqual(saved);
});

test("a tall note uses its available editing area for multiline bullets without internal scrolling", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const initial = {
    version: 1,
    name: "Long notes",
    items: [
      {
        id: "tall-note",
        kind: "note",
        name: "Research",
        text: "Research",
        x: 200,
        y: 120,
        width: 400,
        height: 600,
        rotation: 0,
        locked: false,
        noteColor: "sage",
        noteAlign: "center",
        noteSize: "medium",
        noteBold: false,
      },
    ],
  };
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+o");
  await (
    await chooser
  ).setFiles({
    name: "tall-note.mindboard",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(initial)),
  });
  await expect(note(page)).toHaveCount(1);
  await note(page).dblclick();
  await toolbar(page)
    .getByRole("combobox", { name: "Note alignment", exact: true })
    .selectOption("left");
  await toolbar(page)
    .getByRole("combobox", { name: "Note text size", exact: true })
    .selectOption("small");
  const bullets =
    "Reference ideas\n\n• Natural light\n• Soft shadows\n• Warm highlights\n• Simple shapes\n• Quiet backgrounds\n• Clear silhouettes\n• Gentle contrast\n• A little texture\n• Room to breathe";
  await editor(page).fill(bullets);
  const assertEditorFits = async () => {
    const metrics = await editor(page).evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      width: element.clientWidth,
      parentHeight: element.parentElement!.clientHeight,
    }));
    expect(metrics.clientHeight).toBe(metrics.parentHeight);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
    expect(metrics.scrollTop).toBe(0);
    await expect(editor(page)).toHaveCSS("text-align", "left");
  };
  await assertEditorFits();
  await editor(page).focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("• Keep details sharp");
  await assertEditorFits();
  await page.keyboard.press("Control+Enter");
  await note(page).dblclick();
  await expect(editor(page)).toHaveValue(`${bullets}\n• Keep details sharp`);
  await assertEditorFits();
  await page.screenshot({ path: testInfo.outputPath("tall-note-editor.png") });
});

test("Escape restores the original text and formatting of an existing note", async ({
  page,
}) => {
  await createNote(page, "Keep this direction");
  const original = (await downloadBoard(page)).board.items[0];
  await note(page).dblclick();
  await editor(page).fill("Discard this revision");
  await toolbar(page)
    .getByRole("button", { name: "Rose note", exact: true })
    .click();
  await toolbar(page)
    .getByRole("button", { name: "Bold note text", exact: true })
    .click();
  await toolbar(page)
    .getByRole("combobox", { name: "Note alignment", exact: true })
    .selectOption("right");
  await expect(editor(page)).toBeVisible();
  await editor(page).focus();
  await page.keyboard.press("Escape");
  await expect(note(page)).toContainText("Keep this direction");
  expect((await downloadBoard(page)).board.items[0]).toEqual(original);
});

test("draft formatting survives commit, recovery, and a portable board round trip", async ({
  page,
}) => {
  await page.keyboard.press("n");
  await editor(page).fill("A colorful direction");
  await toolbar(page)
    .getByRole("button", { name: "Sage note", exact: true })
    .click();
  await toolbar(page)
    .getByRole("button", { name: "Bold note text", exact: true })
    .click();
  await toolbar(page)
    .getByRole("combobox", { name: "Note alignment", exact: true })
    .selectOption("center");
  await toolbar(page)
    .getByRole("combobox", { name: "Note text size", exact: true })
    .selectOption("large");
  await expect(editor(page)).toBeVisible();
  await toolbar(page)
    .getByRole("button", { name: "Done editing note", exact: true })
    .click();
  const saved = await downloadBoard(page);
  expect(saved.board.items[0]).toMatchObject({
    text: "A colorful direction",
    noteColor: "sage",
    noteAlign: "center",
    noteSize: "large",
    noteBold: true,
  });
  await expect(note(page).locator(".item-content")).toHaveCSS(
    "text-align",
    "center",
  );
  expect(
    await note(page)
      .locator(".item-content")
      .evaluate((element) => Number(getComputedStyle(element).fontWeight)),
  ).toBeGreaterThan(400);
  await expect(
    toolbar(page).getByRole("button", { name: "Bold note text", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await page.reload();
  await expect(note(page)).toContainText("A colorful direction");
  expect((await downloadBoard(page)).board.items[0]).toMatchObject(
    saved.board.items[0],
  );
  await page.keyboard.press("Control+n");
  await page
    .locator("#confirm-dialog")
    .getByRole("button", { name: "New board", exact: true })
    .click();
  await expect(note(page)).toHaveCount(0);
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+o");
  await (
    await chooser
  ).setFiles({
    name: "colored.mindboard",
    mimeType: "application/json",
    buffer: saved.buffer,
  });
  await expect(note(page)).toContainText("A colorful direction");
  expect((await downloadBoard(page)).board.items[0]).toEqual(
    saved.board.items[0],
  );
});

test("all six colors are distinct and formatting a selected note supports undo", async ({
  page,
}) => {
  await createNote(page, "Palette study");
  const colors = new Set<string>();
  for (const color of ["Yellow", "Sage", "Blue", "Rose", "Lavender", "Sand"]) {
    await toolbar(page)
      .getByRole("button", { name: `${color} note`, exact: true })
      .click();
    colors.add(
      await note(page).evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    );
  }
  expect(colors.size).toBe(6);
  expect((await downloadBoard(page)).board.items[0].noteColor).toBe("sand");
  await page.keyboard.press("Control+z");
  expect((await downloadBoard(page)).board.items[0].noteColor).toBe("lavender");
  await page.keyboard.press("Control+Shift+z");
  expect((await downloadBoard(page)).board.items[0].noteColor).toBe("sand");
});

test("Tab and Add another note create adjacent notes with inherited formatting", async ({
  page,
}) => {
  await page.keyboard.press("n");
  await editor(page).fill("First idea");
  await toolbar(page)
    .getByRole("button", { name: "Blue note", exact: true })
    .click();
  await toolbar(page)
    .getByRole("button", { name: "Bold note text", exact: true })
    .click();
  await toolbar(page)
    .getByRole("combobox", { name: "Note alignment", exact: true })
    .selectOption("center");
  await toolbar(page)
    .getByRole("combobox", { name: "Note text size", exact: true })
    .selectOption("small");
  await editor(page).focus();
  await page.keyboard.press("Tab");
  await expect(note(page)).toHaveCount(2);
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("");
  await editor(page).fill("Second idea");
  await toolbar(page)
    .getByRole("button", { name: "Add another note", exact: true })
    .click();
  await expect(note(page)).toHaveCount(3);
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toBeInViewport({ ratio: 1 });
  await editor(page).fill("Third idea");
  await page.keyboard.press("Control+Enter");
  const notes = (await downloadBoard(page)).board.items;
  expect(notes.map((item) => item.text)).toEqual([
    "First idea",
    "Second idea",
    "Third idea",
  ]);
  for (const item of notes)
    expect(item).toMatchObject({
      noteColor: "blue",
      noteBold: true,
      noteAlign: "center",
      noteSize: "small",
      width: notes[0].width,
      height: notes[0].height,
    });
  expect(notes[1].x).toBe(notes[0].x + notes[0].width + 24);
  expect(notes[2].x).toBe(notes[1].x + notes[1].width + 24);
  expect(notes[1].y).toBe(notes[0].y);
  expect(notes[2].y).toBe(notes[0].y);
});

test("text editing keeps canvas shortcuts and pan mode isolated", async ({
  page,
}) => {
  await page.keyboard.press("n");
  await editor(page).fill("Replace this text");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expect(editor(page)).toHaveValue("");
  await expect(note(page)).toHaveCount(1);
  await page.keyboard.insertText("nif ? 1");
  await page.keyboard.press("Space");
  await expect(editor(page)).toHaveValue("nif ? 1 ");
  await expect(page.getByTestId("canvas")).not.toHaveClass(/space-pan|panning/);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".topbar")).not.toBeVisible();
  await page.keyboard.press("Control+Enter");
  await expect(note(page)).toHaveCount(1);
});

test("a context-created note is positioned at the requested canvas point", async ({
  page,
}) => {
  const position = { x: 390, y: 300 };
  await page.getByTestId("canvas").click({ button: "right", position });
  await page
    .locator("#context-menu")
    .getByRole("menuitem", { name: "Add note", exact: true })
    .click();
  await expect(editor(page)).toBeFocused();
  const box = await bounds(note(page));
  expect(box.x + box.width / 2).toBeCloseTo(position.x, 0);
  expect(box.y + box.height / 2).toBeCloseTo(position.y, 0);
  await editor(page).fill("Placed deliberately");
  await page.keyboard.press("Control+Enter");
});

test("note tools are contextual and locked notes cannot be edited", async ({
  page,
}) => {
  await createNote(page, "Protected idea");
  await expect(toolbar(page)).toBeVisible();
  await expect(page.locator(".topbar")).not.toBeVisible();
  await note(page).click({ button: "right" });
  await page
    .locator("#context-menu")
    .getByRole("menuitem", { name: "Lock selection", exact: true })
    .click();
  await expect(toolbar(page)).not.toBeVisible();
  await note(page).dblclick();
  await expect(editor(page)).not.toBeVisible();
  await note(page).click({ button: "right" });
  await page
    .locator("#context-menu")
    .getByRole("menuitem", { name: "Unlock selection", exact: true })
    .click();
  await expect(toolbar(page)).toBeVisible();
  await note(page).dblclick();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await importImages(page);
  await expect(toolbar(page)).not.toBeVisible();
});

test("the editor and formatting toolbar remain usable in a narrow window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.keyboard.press("n");
  await expect(editor(page)).toBeInViewport({ ratio: 1 });
  await expect(toolbar(page)).toBeInViewport({ ratio: 1 });
  await toolbar(page)
    .getByRole("button", { name: "Rose note", exact: true })
    .click();
  await toolbar(page)
    .getByRole("combobox", { name: "Note text size", exact: true })
    .selectOption("large");
  await editor(page).fill("Room for ideas");
  await toolbar(page)
    .getByRole("button", { name: "Done editing note", exact: true })
    .click();
  await expect(note(page)).toContainText("Room for ideas");
  await expect(toolbar(page)).toBeInViewport({ ratio: 1 });
  const firstWidth = (await bounds(note(page))).width;
  await toolbar(page)
    .getByRole("button", { name: "Add another note", exact: true })
    .click();
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toBeInViewport({ ratio: 1 });
  expect(
    (await bounds(page.locator(".board-item.note.selected"))).width,
  ).toBeCloseTo(firstWidth, 0);
  await page.keyboard.press("Escape");
});

test("clearing an existing note preserves the note as an empty card", async ({
  page,
}) => {
  await createNote(page, "Start again here");
  await note(page).dblclick();
  await editor(page).fill("");
  await page.keyboard.press("Control+Enter");
  await expect(note(page)).toHaveCount(1);
  await expect(note(page)).toHaveAttribute("aria-label", "Note");
  await expect(note(page).locator(".item-content")).toHaveText("");
  await page.keyboard.press("Control+z");
  await expect(note(page)).toContainText("Start again here");
});

test("Enter activates Duplicate in a note's context menu without opening its editor", async ({
  page,
}) => {
  await createNote(page, "A reusable idea");
  await note(page).click({ button: "right" });
  const duplicate = page
    .locator("#context-menu")
    .getByRole("menuitem", { name: "Duplicate", exact: true });
  await expect(duplicate).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(note(page)).toHaveCount(2);
  await expect(editor(page)).not.toBeVisible();
  await expect(page.locator("#context-menu")).not.toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(note(page)).toHaveCount(1);
});

test("a very long draft can be shortened and committed without invalid geometry", async ({
  page,
}) => {
  await page.keyboard.press("n");
  await editor(page).fill("Long line with many words. ".repeat(3600));
  await editor(page).fill("A concise idea");
  await page.keyboard.press("Control+Enter");
  await expect(editor(page)).not.toBeVisible();
  const item = (await downloadBoard(page)).board.items[0];
  expect(item.text).toBe("A concise idea");
  expect(item.height).toBeLessThanOrEqual(100_000);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
});

test("an image finishing its import preserves the active note draft and selection", async ({
  page,
}) => {
  // Delay the actual decoder to deterministically exercise the import/edit race.
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      return new Promise<void>((resolve, reject) =>
        setTimeout(() => {
          decode.call(this).then(resolve, reject);
        }, 600),
      );
    };
  });
  await page.locator("#image-input").setInputFiles(imageFile("arriving.png"));
  await page.keyboard.press("n");
  await editor(page).fill("Keep working while images arrive");
  await expect(page.locator(".board-item.image")).toHaveCount(1);
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Keep working while images arrive");
  await expect(note(page)).toHaveClass(/selected/);
  await expect(toolbar(page)).toBeVisible();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("board-item")).toHaveCount(2);
  await expect(note(page)).toContainText("Keep working while images arrive");
});

test("pasting multiline text creates a saved, undoable note and ignores clipboard HTML", async ({
  page,
}) => {
  const text = "First direction\nSecond direction\n\nA little more context.";
  await pasteText(
    page,
    text,
    '<img src="invalid" onerror="window.unexpectedPaste = true"><b>Rich text</b>',
  );
  await expect(note(page)).toHaveCount(1);
  await expect(note(page).locator(".item-content")).toHaveText(text);
  await expect(note(page).locator("img,b")).toHaveCount(0);
  expect(await page.evaluate(() => "unexpectedPaste" in window)).toBe(false);
  await expect(editor(page)).not.toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(note(page)).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(note(page).locator(".item-content")).toHaveText(text);
  expect((await downloadBoard(page)).board.items[0].text).toBe(text);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await page.reload();
  await expect(note(page).locator(".item-content")).toHaveText(text);
});

test("text paste accepts the size limit and rejects oversized or empty clipboard content", async ({
  page,
}) => {
  await createNote(page, "Keep this note");
  await pasteText(page, "x".repeat(100_001));
  await expect(page.locator("#toast")).toBeVisible();
  await expect(note(page)).toHaveCount(1);
  await expect(note(page)).toContainText("Keep this note");
  await pasteText(page, " \n\t ");
  await expect(note(page)).toHaveCount(1);
  const exactLimit = "x".repeat(100_000);
  await pasteText(page, exactLimit);
  await expect(note(page)).toHaveCount(2);
  const saved = await downloadBoard(page);
  expect(saved.board.items[1].text).toBe(exactLimit);
  expect(saved.board.items[1].height).toBeLessThanOrEqual(100_000);
});

test("real clipboard paste creates a canvas note and edits existing text without extra notes", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() =>
    navigator.clipboard.writeText("Canvas clipboard note"),
  );
  await page.keyboard.press("Control+v");
  await expect(note(page)).toHaveCount(1);
  await expect(note(page)).toContainText("Canvas clipboard note");
  await note(page).dblclick();
  await editor(page).fill("Before ");
  await page.evaluate(() => navigator.clipboard.writeText("pasted\ntext"));
  await page.keyboard.press("Control+v");
  await expect(editor(page)).toHaveValue("Before pasted\ntext");
  await expect(note(page)).toHaveCount(1);
  await page.keyboard.press("Control+Enter");
  await showControls(page);
  const title = page.getByRole("textbox", { name: "Board name", exact: true });
  await title.focus();
  await page.keyboard.press("Control+a");
  await page.evaluate(() =>
    navigator.clipboard.writeText("Pasted board title"),
  );
  await page.keyboard.press("Control+v");
  await expect(title).toHaveValue("Pasted board title");
  await page.keyboard.press("Enter");
  await expect(note(page)).toHaveCount(1);
  await expect(note(page)).toContainText("Before pasted\ntext");
});

test("an image takes precedence when the clipboard also contains plain text", async ({
  page,
}) => {
  const file = imageFile("clipboard-image.png");
  await page.evaluate(
    ({ bytes, name }) => {
      const clipboard = new DataTransfer();
      clipboard.items.add(
        new File([new Uint8Array(bytes)], name, { type: "image/png" }),
      );
      clipboard.setData(
        "text/plain",
        "This accompanying text should not create a note",
      );
      document.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: clipboard,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { bytes: [...file.buffer], name: file.name },
  );
  await expect(page.locator(".board-item.image")).toHaveCount(1);
  await expect(note(page)).toHaveCount(0);
  await expect(page.locator(".board-item.image img")).toHaveJSProperty(
    "naturalWidth",
    240,
  );
});
