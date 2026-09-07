import { deflateSync } from "node:zlib";
import { expect, type Page } from "@playwright/test";

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** Actual, decodable PNG fixtures; dimensions are large enough to manipulate. */
export function imageFile(
  name = "reference.png",
  rgb = [90, 130, 170],
  width = 240,
  height = 160,
) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      pixels[offset] = rgb[0];
      pixels[offset + 1] = rgb[1];
      pixels[offset + 2] = rgb[2];
    }
  }
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  };
}

export async function importImages(page: Page, names = ["reference.png"]) {
  const previousCount = await page.getByTestId("board-item").count();
  await page
    .locator("#image-input")
    .setInputFiles(
      names.map((name, index) => imageFile(name, [80 + index * 35, 120, 170])),
    );
  await expect(page.getByTestId("board-item")).toHaveCount(
    previousCount + names.length,
  );
}

export const boardItem = (page: Page, name = "reference.png") =>
  page.locator(`.board-item[aria-label="${name}"]`);

export async function bounds(locator: ReturnType<typeof boardItem>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected a visible canvas item");
  return box;
}

export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

export async function openBoard(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open board", exact: true }).click();
  await (await chooser).setFiles(file);
}
