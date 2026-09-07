import { expect, test, type Page } from "@playwright/test";
import { imageFile, importImages, showControls } from "./fixtures";

/** Real decodable PNG files padded after IEND, constructed in-browser to avoid
 * copying ~100 MiB through the test driver's JSON transport. */
async function importPaddedPngs(
  page: Page,
  bytes: number,
  count: number,
): Promise<void> {
  const png = imageFile("boundary.png", [80, 140, 110], 2, 2).buffer;
  await page.evaluate(
    ({ header, bytes, count }) => {
      const payload = new Uint8Array(bytes);
      payload.set(header);
      const files = new DataTransfer();
      for (let index = 0; index < count; index++)
        files.items.add(
          new File([payload], `boundary-${index}.png`, { type: "image/png" }),
        );
      const input = document.querySelector<HTMLInputElement>("#image-input")!;
      input.files = files.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { header: [...png], bytes, count },
  );
}

test.describe("image and board size boundaries", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
    await showControls(page);
  });

  test("rejects a file one byte over 20 MiB and preserves existing recovery", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await importImages(page, ["keep-me.png"]);
    await expect(page.locator("#save-status")).toHaveText(
      "Saved on this device",
    );
    await importPaddedPngs(page, 20 * 1024 * 1024 + 1, 1);
    await expect(page.locator("#toast")).toContainText("under 20 MB");
    await expect(page.getByTestId("board-item")).toHaveCount(1);
    await page.reload();
    await showControls(page);
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
    await expect(
      page.locator('.board-item[aria-label="keep-me.png"]'),
    ).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test("accepts an exact 20 MiB raster and restores it after restarting", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await importPaddedPngs(page, 20 * 1024 * 1024, 1);
    await expect(page.getByTestId("board-item")).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(page.locator("#save-status")).toHaveText(
      "Saved on this device",
    );
    await expect(page.locator(".board-item img")).toHaveJSProperty(
      "naturalWidth",
      2,
    );
    await page.reload();
    await showControls(page);
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("board-item")).toHaveCount(1);
    await expect(page.locator(".board-item img")).toHaveJSProperty(
      "naturalWidth",
      2,
    );
    expect(errors).toEqual([]);
  });

  test("rejects an import batch exceeding 100 MiB and retains the previous board after restart", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await importImages(page, ["original.png"]);
    await expect(page.locator("#save-status")).toHaveText(
      "Saved on this device",
    );
    await importPaddedPngs(page, 19 * 1024 * 1024, 4);
    await expect(page.locator("#toast")).toContainText("100 MB", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("board-item")).toHaveCount(1);
    await expect(
      page.locator('.board-item[aria-label="original.png"]'),
    ).toHaveCount(1);
    await page.reload();
    await showControls(page);
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
    await expect(
      page.locator('.board-item[aria-label="original.png"]'),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeDisabled();
    expect(errors).toEqual([]);
  });
});
