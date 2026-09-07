import { supportedImage } from "./board";

function sourceBytes(src: string): Uint8Array<ArrayBuffer> {
  const binary = atob(src.slice(src.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Standard HTML retains the original compressed source for pasting back.
 * Read only our image marker; never render clipboard HTML or fetch its URLs. */
export function copiedImageFromHtml(html: string): File | null {
  if (html.length > Math.ceil((20 * 1024 * 1024) / 3) * 4 + 1024) return null;
  const match =
    /<img src="(data:(image\/(?:png|jpeg|webp|gif|avif));base64,[A-Za-z0-9+/]+={0,2})" data-mindboard-image="1"\s*\/?\s*>/i.exec(
      html,
    );
  if (!match) return null;
  try {
    const bytes = sourceBytes(match[1]);
    const type = match[2].toLowerCase();
    if (!supportedImage({ type, size: bytes.length })) return null;
    return new File([bytes], `Copied image.${type.slice(6)}`, { type });
  } catch {
    return null;
  }
}

/** Standard PNG clipboard data is readable by image editors and other apps.
 * Always use the source image, independently of its placement on the board. */
async function imagePng(src: string): Promise<Blob> {
  if (src.startsWith("data:image/png;base64,")) {
    return new Blob([sourceBytes(src)], { type: "image/png" });
  }

  const image = new Image();
  image.src = src;
  await image.decode();
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height || width * height > 80_000_000)
    throw new Error("This image is too large to copy.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the clipboard image.");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not encode the clipboard image.")),
        "image/png",
      );
    });
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export async function copyImage(src: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
    throw new Error("Image copying is unavailable in this browser.");
  // Start the write during the user gesture; image decoding can finish later.
  const png = imagePng(src);
  // A denied clipboard write can finish before asynchronous decoding does.
  void png.catch(() => {});
  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": png,
      "text/html": new Blob([`<img src="${src}" data-mindboard-image="1">`], {
        type: "text/html",
      }),
    }),
  ]);
}
