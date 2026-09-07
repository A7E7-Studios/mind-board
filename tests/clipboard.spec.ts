import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  bounds,
  drag,
  imageFile,
  importImages,
  showControls,
} from "./fixtures";

const errors = new WeakMap<Page, string[]>();
const previousClipboard = new WeakMap<
  Page,
  { type: string; bytes: number[] }[][]
>();

test.beforeEach(async ({ page, context }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  try {
    previousClipboard.set(
      page,
      await page.evaluate(async () =>
        Promise.all(
          (await navigator.clipboard.read()).map(async (item) =>
            Promise.all(
              item.types.map(async (type) => ({
                type,
                bytes: Array.from(
                  new Uint8Array(
                    await (await item.getType(type)).arrayBuffer(),
                  ),
                ),
              })),
            ),
          ),
        ),
      ),
    );
  } catch {
    /* Clipboard contents may be unavailable in a fresh browser. */
  }
});

test.afterEach(async ({ page }) => {
  const previous = previousClipboard.get(page);
  if (previous) {
    try {
      await page.bringToFront();
      await page.evaluate(async (items) => {
        // Remove a test's failure injection before restoring browser clipboard data.
        if (Object.hasOwn(navigator.clipboard, "write"))
          Reflect.deleteProperty(navigator.clipboard, "write");
        if (!items.length) return navigator.clipboard.writeText("");
        await navigator.clipboard.write(
          items.map(
            (item) =>
              new ClipboardItem(
                Object.fromEntries(
                  item.map(({ type, bytes }) => [
                    type,
                    new Blob([new Uint8Array(bytes)], { type }),
                  ]),
                ),
              ),
          ),
        );
      }, previous);
    } catch {
      /* Best effort: unsupported clipboard formats may not be writable. */
    }
  }
  expect(errors.get(page), "No uncaught browser errors").toEqual([]);
});

async function exportBoard(page: Page) {
  await page.getByTestId("canvas").focus();
  const downloaded = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const stream = await (await downloaded).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function createSource(page: Page, mime: "image/png" | "image/jpeg") {
  return page.evaluate((mime) => {
    const canvas = document.createElement("canvas");
    canvas.width = 755;
    canvas.height = 374;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#e04020";
    context.fillRect(0, 0, 378, 187);
    context.fillStyle = "#2080d0";
    context.fillRect(378, 0, 377, 187);
    context.fillStyle = "rgba(40, 180, 80, 0.5)";
    context.fillRect(0, 187, 378, 187);
    return canvas.toDataURL(mime, 0.95);
  }, mime);
}

async function imagePixels(page: Page, source: string) {
  return page.evaluate(async (source) => {
    const image = await createImageBitmap(await (await fetch(source)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const samples = [
      [100, 80],
      [600, 80],
      [100, 280],
      [600, 280],
    ].map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
    image.close();
    return { width: canvas.width, height: canvas.height, samples };
  }, source);
}

async function consumer(page: Page) {
  const external = await page.context().newPage();
  await external.route("**/clipboard-consumer", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Independent clipboard consumer</title><p>Clipboard consumer</p>",
    }),
  );
  await external.goto("/clipboard-consumer");
  return external;
}

async function readClipboardImage(page: Page) {
  await page.bringToFront();
  return page.evaluate(async () => {
    const entries = await navigator.clipboard.read();
    const image = entries.find((item) => item.types.includes("image/png"));
    if (!image)
      throw new Error("Clipboard does not expose a standard PNG image");
    const blob = await image.getType("image/png");
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  });
}

for (const mime of ["image/png", "image/jpeg"] as const) {
  test(`${mime} copies original image pixels after resize and pastes into the board and an independent consumer`, async ({
    page,
  }) => {
    const source = await createSource(page, mime);
    const expected = await imagePixels(page, source);
    await page.locator("#image-input").setInputFiles({
      name: mime === "image/png" ? "alpha.png" : "photo.jpg",
      mimeType: mime,
      buffer: Buffer.from(source.split(",")[1], "base64"),
    });
    const item = page.getByTestId("board-item");
    await expect(item).toHaveCount(1);
    const initial = await bounds(item);
    const handle = await bounds(item.getByTestId("resize-handle"));
    await drag(
      page,
      { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      {
        x: handle.x + handle.width / 2 - initial.width / 2,
        y: handle.y + handle.height / 2 - initial.height / 2,
      },
    );
    const beforeCopy = await exportBoard(page);
    expect(beforeCopy.items[0].width).toBeCloseTo(240, 1);
    await page.keyboard.press("Control+c");
    await expect(page.locator("#toast")).toContainText(/copied/i);
    expect(await exportBoard(page)).toEqual(beforeCopy);
    const external = await consumer(page);
    const clipboardSource = await readClipboardImage(external);
    const html = await external.evaluate(async () =>
      (await (await navigator.clipboard.read())[0].getType("text/html")).text(),
    );
    expect(html).toContain('data-mindboard-image="1"');
    expect(html).toContain(source);
    const expectOriginalPixels = (
      actual: Awaited<ReturnType<typeof imagePixels>>,
    ) => {
      expect(actual.width).toBe(expected.width);
      expect(actual.height).toBe(expected.height);
      if (mime === "image/png")
        expect(actual.samples).toEqual(expected.samples);
      else {
        // ImageBitmap and HTMLImageElement JPEG decode paths may round an RGB
        // channel by one level; dimensions and opaque alpha remain exact.
        actual.samples.forEach((pixel, index) =>
          pixel.forEach((value, channel) => {
            expect(
              Math.abs(value - expected.samples[index][channel]),
            ).toBeLessThanOrEqual(channel === 3 ? 0 : 1);
          }),
        );
      }
    };
    expectOriginalPixels(await imagePixels(external, clipboardSource));
    if (mime === "image/png") {
      expect(expected.samples[2][3]).toBe(128);
      expect(expected.samples[3][3]).toBe(0);
    }
    await external.close();
    await page.bringToFront();
    await page.getByTestId("canvas").focus();
    await page.keyboard.press("Control+v");
    await expect(page.getByTestId("board-item")).toHaveCount(2);
    const pastedSource = await page
      .getByTestId("board-item")
      .last()
      .locator("img")
      .getAttribute("src");
    expect(pastedSource).toBe(source);
    expectOriginalPixels(await imagePixels(page, pastedSource!));
    await page.keyboard.press("Control+z");
    expect(await exportBoard(page)).toEqual(beforeCopy);
    await page.keyboard.press("Control+z");
    expect((await exportBoard(page)).items[0].width).toBeCloseTo(480, 3);
  });
}

test("the Copy image menu command also copies a locked image", async ({
  page,
}) => {
  await importImages(page);
  const item = page.getByTestId("board-item");
  await item.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Rotate right", exact: true })
    .click();
  await item.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Lock selection", exact: true })
    .click();
  await expect(item).toHaveClass(/locked/);
  const saved = await exportBoard(page);
  await item.click({ button: "right" });
  const copy = page.getByRole("menuitem", { name: "Copy image", exact: true });
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(page.locator("#toast")).toContainText(/copied/i);
  const external = await consumer(page);
  expect(
    await imagePixels(external, await readClipboardImage(external)),
  ).toMatchObject({ width: 240, height: 160 });
  await external.close();
  await page.bringToFront();
  expect(await exportBoard(page)).toEqual(saved);
});

test("a compressed JPEG pastes its original source even when its standard clipboard PNG exceeds20 MiB", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const source = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 3072;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(3072, 3072);
    let seed = 123456789;
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        pixels.data[i + channel] = seed & 255;
      }
      pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.9);
  });
  const bytes = Buffer.from(source.split(",")[1], "base64");
  expect(bytes.length).toBeLessThan(20 * 1024 * 1024);
  await page.locator("#image-input").setInputFiles({
    name: "large-noise.jpg",
    mimeType: "image/jpeg",
    buffer: bytes,
  });
  await expect(page.getByTestId("board-item")).toHaveCount(1);
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("Control+c");
  await expect(page.locator("#toast")).toContainText(/copied/i, {
    timeout: 20_000,
  });
  const external = await consumer(page);
  const copied = await external.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0];
    const png = await item.getType("image/png");
    const decoded = await createImageBitmap(png);
    const html = await (await item.getType("text/html")).text();
    const result = {
      pngSize: png.size,
      width: decoded.width,
      height: decoded.height,
      marker: html.includes('data-mindboard-image="1"'),
    };
    decoded.close();
    return result;
  });
  expect(copied).toMatchObject({ width: 3072, height: 3072, marker: true });
  expect(copied.pngSize).toBeGreaterThan(20 * 1024 * 1024);
  await external.close();
  await page.bringToFront();
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("Control+v");
  await expect(page.getByTestId("board-item")).toHaveCount(2, {
    timeout: 20_000,
  });
  const pasted = page.getByTestId("board-item").last().locator("img");
  await expect(pasted).toHaveJSProperty("naturalWidth", 3072);
  await expect(pasted).toHaveJSProperty("naturalHeight", 3072);
  const actual = (await pasted.getAttribute("src"))!;
  expect(createHash("sha256").update(actual).digest("hex")).toBe(
    createHash("sha256").update(source).digest("hex"),
  );
});

test("WebP, GIF, and AVIF copy as standard PNG and paste their original formats", async ({
  page,
}) => {
  const webp = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    canvas.getContext("2d")!.fillRect(0, 0, 96, 64);
    return canvas.toDataURL("image/webp");
  });
  const files = [
    {
      name: "copy.webp",
      mimeType: "image/webp",
      buffer: Buffer.from(webp.split(",")[1], "base64"),
    },
    {
      name: "copy.gif",
      mimeType: "image/gif",
      buffer: Buffer.from(
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        "base64",
      ),
    },
    {
      name: "copy.avif",
      mimeType: "image/avif",
      buffer: await readFile("tests/fixtures/reference.avif"),
    },
  ];
  for (const file of files) {
    const count = await page.getByTestId("board-item").count();
    await page.locator("#image-input").setInputFiles(file);
    await expect(page.getByTestId("board-item")).toHaveCount(count + 1);
    const source = (await page
      .getByTestId("board-item")
      .last()
      .locator("img")
      .getAttribute("src"))!;
    const expected = await imagePixels(page, source);
    await page.getByTestId("canvas").focus();
    await page.keyboard.press("Control+c");
    await expect(page.locator("#toast")).toContainText(/copied/i);
    const external = await consumer(page);
    const actual = await imagePixels(
      external,
      await readClipboardImage(external),
    );
    expect({ width: actual.width, height: actual.height }).toEqual({
      width: expected.width,
      height: expected.height,
    });
    await external.close();
    await page.bringToFront();
    await page.getByTestId("canvas").focus();
    await page.keyboard.press("Control+v");
    await expect(page.getByTestId("board-item")).toHaveCount(count + 2);
    await expect(
      page.getByTestId("board-item").last().locator("img"),
    ).toHaveAttribute("src", source);
  }
});

test("malformed or unrelated clipboard HTML falls back to image or plain text without executing or fetching it", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.context().route("https://clipboard.invalid/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ body: "" });
  });
  const fallback = imageFile("fallback.png");
  const htmlCases = [
    '<img src="https://clipboard.invalid/pixel" data-mindboard-image="1"><script>document.documentElement.dataset.clipboardExecuted="yes"</script>',
    '<img src="data:image/png;base64,!!!" data-mindboard-image="1" onerror="document.documentElement.dataset.clipboardExecuted=\'yes\'">',
    `<img src="data:image/png;base64,${fallback.buffer.toString("base64")}">`,
  ];
  for (const [index, html] of htmlCases.entries()) {
    await page.evaluate(
      ({ html, index, bytes }) => {
        const data = new DataTransfer();
        data.setData("text/html", html);
        data.setData("text/plain", `Fallback text ${index}`);
        if (index === 0)
          data.items.add(
            new File([new Uint8Array(bytes)], "fallback.png", {
              type: "image/png",
            }),
          );
        document.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { html, index, bytes: Array.from(fallback.buffer) },
    );
    await expect(page.getByTestId("board-item")).toHaveCount(index + 1);
    if (index === 0)
      await expect(
        page.getByTestId("board-item").last().locator("img"),
      ).toHaveJSProperty("naturalWidth", 240);
    else
      await expect(page.getByTestId("board-item").last()).toContainText(
        `Fallback text ${index}`,
      );
  }
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-clipboard-executed",
    "yes",
  );
  expect(requests).toEqual([]);
});

test("copying selected text in the board title or note editor retains native text behavior", async ({
  page,
}) => {
  await importImages(page);
  await showControls(page);
  const title = page.getByRole("textbox", { name: "Board name", exact: true });
  await title.fill("Text to copy");
  await title.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "Text to copy",
  );
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("n");
  const editor = page.getByRole("textbox", { name: "Note text", exact: true });
  await editor.fill("Note text selection");
  await editor.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "Note text selection",
  );
  await expect(editor).toHaveValue("Note text selection");
  await expect(page.getByTestId("board-item")).toHaveCount(2);
});

test("no selection, multiple images, and notes never copy an arbitrary image", async ({
  page,
}) => {
  const sentinel = "Keep existing clipboard";
  const checkUnavailable = async () => {
    const copy = page.getByRole("menuitem", {
      name: "Copy image",
      exact: true,
    });
    if (await copy.count()) await expect(copy).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+c");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      sentinel,
    );
  };
  await page.evaluate((text) => navigator.clipboard.writeText(text), sentinel);
  await page
    .getByTestId("canvas")
    .click({ button: "right", position: { x: 30, y: 30 } });
  await checkUnavailable();
  await importImages(page, ["one.png", "two.png"]);
  await page.getByTestId("board-item").last().click({ button: "right" });
  await expect(page.locator(".board-item.selected")).toHaveCount(2);
  await checkUnavailable();
  await page.keyboard.press("n");
  await page
    .getByRole("textbox", { name: "Note text", exact: true })
    .fill("A note");
  await page.keyboard.press("Control+Enter");
  await page.locator(".board-item.note").click({ button: "right" });
  await checkUnavailable();
});

test("a denied clipboard write shows an actionable error and preserves the board", async ({
  page,
}) => {
  await importImages(page);
  const saved = await exportBoard(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "write", {
      configurable: true,
      value: async () => {
        throw new DOMException(
          "Clipboard permission denied",
          "NotAllowedError",
        );
      },
    });
  });
  await page.keyboard.press("Control+c");
  await expect(page.locator("#toast")).toContainText(/clipboard|copy/i);
  await expect(page.locator("#toast")).toContainText(
    /denied|could not|failed/i,
  );
  expect(await exportBoard(page)).toEqual(saved);
});
