import { expect, test, type Page } from "@playwright/test";
import { bounds, imageFile, importImages, showControls } from "./fixtures";

type PasteKind =
  "plain text" | "styled note" | "empty note" | "image file" | "image HTML";
const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page), "No uncaught browser errors").toEqual([]);
});

async function paste(page: Page, kind: PasteKind) {
  const fixture = imageFile("position.png");
  const note = {
    id: "source-note",
    kind: "note",
    name: "Position",
    text: kind === "empty note" ? "" : "Styled note",
    x: 0,
    y: 0,
    width: 320,
    height: 440,
    rotation: 90,
    locked: false,
    noteColor: "sage",
    noteAlign: "left",
    noteSize: "small",
    noteBold: true,
  };
  await page.evaluate(
    ({ kind, bytes, note }) => {
      const data = new DataTransfer();
      if (kind === "plain text")
        data.setData(
          "text/plain",
          Array.from({ length: 14 }, (_, i) => `Line ${i + 1}`).join("\n"),
        );
      else if (kind === "styled note" || kind === "empty note")
        data.setData(
          "text/html",
          `<div data-mindboard-note="${encodeURIComponent(JSON.stringify(note))}">${note.text}</div>`,
        );
      else if (kind === "image file")
        data.items.add(
          new File([new Uint8Array(bytes)], "position.png", {
            type: "image/png",
          }),
        );
      else {
        const binary = bytes.map((byte) => String.fromCharCode(byte)).join("");
        data.setData(
          "text/html",
          `<img src="data:image/png;base64,${btoa(binary)}" data-mindboard-image="1">`,
        );
      }
      document.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { kind, bytes: Array.from(fixture.buffer), note },
  );
}

async function expectCenter(
  page: Page,
  expected: { x: number; y: number },
  count = 1,
) {
  await expect(page.getByTestId("board-item")).toHaveCount(count);
  const box = await bounds(page.getByTestId("board-item").last());
  expect(box.x + box.width / 2).toBeCloseTo(expected.x, 1);
  expect(box.y + box.height / 2).toBeCloseTo(expected.y, 1);
}

async function canvasCenter(page: Page) {
  const box = await bounds(page.getByTestId("canvas"));
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

for (const kind of [
  "plain text",
  "styled note",
  "empty note",
  "image file",
  "image HTML",
] as const) {
  test(`${kind} centers under the mouse without moving the viewport`, async ({
    page,
  }) => {
    const target = { x: 350, y: 300 };
    await page.mouse.move(target.x, target.y);
    const view = await page.locator("#world").getAttribute("style");
    await paste(page, kind);
    await expectCenter(page, target);
    expect(await page.locator("#world").getAttribute("style")).toBe(view);
  });
}

test("paste resolves the current pointer over an item through pan and zoom", async ({
  page,
}) => {
  await importImages(page);
  await page.mouse.move(500, 350);
  await page.mouse.wheel(0, -300);
  await expect
    .poll(() => page.locator("#world").getAttribute("style"))
    .toContain("scale(1.2");
  await page.mouse.move(500, 350);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(620, 400, { steps: 8 });
  await page.mouse.up({ button: "middle" });
  const original = await bounds(page.getByTestId("board-item"));
  const target = {
    x: original.x + original.width / 2,
    y: original.y + original.height / 2,
  };
  await page.mouse.move(target.x, target.y);
  const view = await page.locator("#world").getAttribute("style");
  await paste(page, "styled note");
  await expectCenter(page, target, 2);
  expect(await page.locator("#world").getAttribute("style")).toBe(view);
});

test("without a known mouse position paste centers in the viewport", async ({
  page,
}) => {
  await paste(page, "image HTML");
  await expectCenter(page, await canvasCenter(page));
});

test("leaving the canvas resets paste placement to viewport center", async ({
  page,
}) => {
  await showControls(page);
  await page.mouse.move(350, 300);
  await page.mouse.move(20, 20);
  await page.getByTestId("canvas").focus();
  await paste(page, "plain text");
  await expectCenter(page, await canvasCenter(page));
});

test("window blur forgets the prior mouse position", async ({ page }) => {
  await page.mouse.move(350, 300);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await paste(page, "empty note");
  await expectCenter(page, await canvasCenter(page));
});

test("asynchronous image decoding retains the mouse position captured at paste time", async ({
  page,
}) => {
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      return new Promise<void>((resolve, reject) =>
        setTimeout(() => decode.call(this).then(resolve, reject), 600),
      );
    };
  });
  const target = { x: 350, y: 300 };
  await page.mouse.move(target.x, target.y);
  await paste(page, "image file");
  await page.mouse.move(900, 600);
  await expectCenter(page, target);
});

test("paste inside a note editor never creates a reference at the mouse", async ({
  page,
}) => {
  await page.keyboard.press("n");
  const editor = page.getByRole("textbox", { name: "Note text", exact: true });
  await editor.fill("Keep editing");
  await page.mouse.move(200, 200);
  // A clipboard event targeting the editor must remain available to native text input.
  const prevented = await editor.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "Text for this editor");
    const event = new ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(editor).toHaveValue("Keep editing");
  await expect(page.getByTestId("board-item")).toHaveCount(1);
});
