import { expect, test } from "@playwright/test";
import { openBoard, showControls } from "./fixtures";

test("renders the empty and populated workspace at desktop size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  await page.screenshot({ path: "docs/screenshots/empty-board.png" });
  await showControls(page);
  await page.screenshot({
    path: "docs/screenshots/full-controls-empty-board.png",
  });

  // Original canvas drawings provide self-contained, reproducible reference artwork.
  const images = await page.evaluate(() => {
    const palettes = [
      ["#d5b493", "#b8795b", "#754e43", "#ddc5a1"],
      ["#96aaa6", "#4f7979", "#254c51", "#d9d1b8"],
      ["#c6c0b7", "#8c8c84", "#4d5a59", "#efdfc4"],
      ["#b4bbc4", "#7d8a9e", "#445674", "#e1c9a8"],
    ];
    return palettes.map((colors, index) => {
      const image = document.createElement("canvas");
      image.width = 600;
      image.height = 400;
      const ctx = image.getContext("2d")!;
      const sky = ctx.createLinearGradient(0, 0, 0, 400);
      sky.addColorStop(0, colors[0]);
      sky.addColorStop(1, colors[3]);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 600, 400);
      ctx.fillStyle = colors[3];
      ctx.beginPath();
      ctx.arc(425 - index * 42, 105, 38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors[1];
      ctx.beginPath();
      ctx.moveTo(0, 270);
      ctx.bezierCurveTo(140, 110 + index * 10, 190, 285, 360, 200);
      ctx.bezierCurveTo(450, 125, 490, 175, 600, 175);
      ctx.lineTo(600, 400);
      ctx.lineTo(0, 400);
      ctx.fill();
      ctx.fillStyle = colors[2];
      ctx.beginPath();
      ctx.moveTo(0, 345);
      ctx.bezierCurveTo(100, 240, 210, 350, 310, 290);
      ctx.bezierCurveTo(450, 215, 500, 305, 600, 250);
      ctx.lineTo(600, 400);
      ctx.lineTo(0, 400);
      ctx.fill();
      return image.toDataURL("image/png");
    });
  });
  const items = images.map((src, index) => ({
    id: `sample-${index}`,
    kind: "image",
    name: [
      "Warmth & atmosphere.png",
      "Coastal greens.png",
      "Quiet forms.png",
      "Blue hour.png",
    ][index],
    src,
    x: (index % 2) * 342,
    y: Math.floor(index / 2) * 246,
    width: 320,
    height: 213.33,
    rotation: 0,
    locked: false,
  }));
  const note = {
    id: "sample-note",
    kind: "note",
    name: "Direction",
    text: "LIGHT & STILLNESS\n\nSoft edges.\nEarthy color.\nRoom to rest.",
    x: 700,
    y: 80,
    width: 260,
    height: 270,
    rotation: 0,
    locked: false,
  };
  await openBoard(page, {
    name: "Light and stillness.mindboard",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        name: "Light & stillness",
        items: [...items, note],
      }),
    ),
  });
  await expect(page.getByTestId("board-item")).toHaveCount(5);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  // Dismiss the transient import notification before capturing the resting workspace.
  await expect(page.locator("#toast")).not.toBeVisible({ timeout: 6000 });
  await page.mouse.move(20, 90);
  await page.screenshot({ path: "docs/screenshots/full-controls-board.png" });
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("f");
  await expect(page.locator(".topbar")).not.toBeVisible();
  await page.screenshot({ path: "docs/screenshots/populated-board.png" });
  for (const item of await page.getByTestId("board-item").all())
    await expect(item).toBeInViewport();
});
