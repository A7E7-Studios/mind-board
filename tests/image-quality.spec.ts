import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

/** Alternating native-resolution pixels disappear if an image is first
 * rasterized at its 480px placement width and that bitmap is enlarged. */
async function createDetailPattern(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 512;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    for (let x = 0; x < canvas.width; x += 2)
      context.fillRect(x, 0, 1, canvas.height);
    return canvas.toDataURL("image/png");
  });
}

async function importPattern(
  page: Page,
  source: string,
  route: "drop" | "paste",
) {
  await page.evaluate(
    ({ source, route }) => {
      const bytes = Uint8Array.from(atob(source.split(",")[1]), (char) =>
        char.charCodeAt(0),
      );
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], "native-detail.png", { type: "image/png" }),
      );
      const canvas = document.querySelector<HTMLElement>("#canvas")!;
      canvas.focus();
      canvas.dispatchEvent(
        route === "drop"
          ? new DragEvent("drop", {
              bubbles: true,
              dataTransfer: transfer,
              clientX: 640,
              clientY: 400,
            })
          : new ClipboardEvent("paste", {
              bubbles: true,
              clipboardData: transfer,
            }),
      );
    },
    { source, route },
  );
  await expect(page.getByTestId("board-item")).toHaveCount(1);
}

async function zoomToNativePixels(page: Page) {
  await page.getByTestId("board-item").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Original pixels", exact: true })
    .click();
  await expect(page.locator("#zoom-label")).toHaveText("400%");
  await expect(page.locator(".board-item img")).toHaveJSProperty(
    "naturalWidth",
    1920,
  );
  const physicalWidth =
    (await page.locator(".board-item img").boundingBox())!.width *
    (await page.evaluate(() => devicePixelRatio));
  expect(physicalWidth).toBe(1920);
}

async function visibleDetail(page: Page) {
  // Analyze browser screenshot pixels, never the original source image.
  const screenshot = await page.screenshot({
    clip: { x: 384, y: 360, width: 512, height: 64 },
  });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let black = 0,
      white = 0,
      adjacentDifference = 0,
      pairs = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const index = (y * canvas.width + x) * 4;
        if (pixels[index] < 40) black++;
        if (pixels[index] > 215) white++;
        if (x) {
          adjacentDifference += Math.abs(pixels[index] - pixels[index - 4]);
          pairs++;
        }
      }
    }
    return {
      blackFraction: black / (canvas.width * canvas.height),
      whiteFraction: white / (canvas.width * canvas.height),
      adjacentContrast: adjacentDifference / pairs,
    };
  }, screenshot.toString("base64"));
}

for (const route of ["drop", "paste"] as const) {
  test(`${route} keeps original image bytes and renders native pixel detail after zooming`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
    const source = await createDetailPattern(page);
    await importPattern(page, source, route);
    const image = page.locator(".board-item img");
    await expect(image).toHaveAttribute("src", source);
    await expect(image).toHaveJSProperty("naturalWidth", 1920);
    await expect(image).toHaveJSProperty("naturalHeight", 512);
    expect((await image.boundingBox())!.width).toBe(480);
    // First capture the small placement to ensure its initial raster exists.
    await page.screenshot();
    await zoomToNativePixels(page);
    const detail = await visibleDetail(page);
    expect(detail.blackFraction).toBeGreaterThan(0.45);
    expect(detail.whiteFraction).toBeGreaterThan(0.45);
    expect(detail.adjacentContrast).toBeGreaterThan(220);

    const downloadPromise = page.waitForEvent("download");
    await page.keyboard.press("Control+s");
    const download = await downloadPromise;
    const saved = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(saved.items[0].src).toBe(source);
    expect(saved.items[0].width).toBe(480);
    await expect(page.locator("#save-status")).toHaveText(
      "Saved on this device",
    );
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
    await expect(image).toHaveAttribute("src", source);
    await expect(image).toHaveJSProperty("naturalWidth", 1920);
    await expect(image).toHaveJSProperty("naturalHeight", 512);
    expect(errors).toEqual([]);
  });
}

test("screen-detail check detects an intentionally downsampled image", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  await importPattern(page, await createDetailPattern(page), "drop");
  await zoomToNativePixels(page);
  // Negative control verifies that the contrast assertion detects the reported
  // symptom instead of merely proving the source image contains sharp pixels.
  await page.locator(".board-item img").evaluate(async (node) => {
    const image = node as HTMLImageElement;
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 128;
    canvas
      .getContext("2d")!
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = canvas.toDataURL("image/png");
    await image.decode();
  });
  const detail = await visibleDetail(page);
  expect(detail.blackFraction).toBeLessThan(0.05);
  expect(detail.whiteFraction).toBeLessThan(0.05);
  expect(detail.adjacentContrast).toBeLessThan(10);
});

for (const pixelRatio of [1, 1.5]) {
  test.describe(`ordinary zoom on a resized reference at DPR ${pixelRatio}`, () => {
    test.use({ deviceScaleFactor: pixelRatio });

    test("restores source detail automatically and preserves original bytes through save and reload", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
      const source = await createDetailPattern(page);
      await importPattern(page, source, "drop");
      const image = page.locator(".board-item img");
      const item = page.getByTestId("board-item");
      await item.click();
      const originalPlacement = (await image.boundingBox())!;
      const handle = (await item.getByTestId("resize-handle").boundingBox())!;
      const start = {
        x: handle.x + handle.width / 2,
        y: handle.y + handle.height / 2,
      };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(
        start.x - originalPlacement.width * 0.75,
        start.y - originalPlacement.height * 0.75,
        { steps: 8 },
      );
      await page.mouse.up();
      const small = (await image.boundingBox())!;
      expect(small.width).toBeCloseTo(120, 3);
      expect(small.height).toBeCloseTo(32, 3);
      await expect(image).toHaveAttribute("src", source);
      await expect(image).toHaveJSProperty("naturalWidth", 1920);
      await page.screenshot();

      // Ordinary wheel events only: neither Original pixels nor any direct
      // transform/style mutation may repair the image before this assertion.
      await page.mouse.move(
        small.x + small.width / 2,
        small.y + small.height / 2,
      );
      // High-DPI browser wheel units can differ from CSS wheel units, so keep
      // correcting from measured physical size rather than assuming a factor.
      for (let step = 0; step < 40; step++) {
        const physicalWidth = (await image.boundingBox())!.width * pixelRatio;
        const ratio = 1920 / physicalWidth;
        if (Math.abs(physicalWidth - 1920) < 0.05) break;
        const delta = -Math.min(100, Math.log(ratio) / 0.002);
        await page.mouse.wheel(0, delta);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
      }
      expect((await image.boundingBox())!.width * pixelRatio).toBeCloseTo(
        1920,
        1,
      );
      const detail = await visibleDetail(page);
      expect(detail.blackFraction).toBeGreaterThan(0.45);
      expect(detail.whiteFraction).toBeGreaterThan(0.45);
      expect(detail.adjacentContrast).toBeGreaterThan(220);

      await page.getByTestId("canvas").focus();
      const downloadPromise = page.waitForEvent("download");
      await page.keyboard.press("Control+s");
      const saved = JSON.parse(
        await readFile((await (await downloadPromise).path())!, "utf8"),
      );
      expect(saved.items[0].src).toBe(source);
      expect(saved.items[0].width).toBeCloseTo(120, 3);
      expect(saved.items[0].height).toBeCloseTo(32, 3);
      await expect(page.locator("#save-status")).toHaveText(
        "Saved on this device",
      );
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
      await expect(image).toHaveAttribute("src", source);
      await expect(image).toHaveJSProperty("naturalWidth", 1920);
      await expect(image).toHaveJSProperty("naturalHeight", 512);
      expect(
        await item.evaluate((node) => parseFloat(node.style.width)),
      ).toBeCloseTo(120, 3);
      expect(errors).toEqual([]);
    });
  });
}
