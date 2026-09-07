/** Portable board data and deterministic operations, independent of the UI. */
export type NoteColor =
  "yellow" | "sage" | "blue" | "rose" | "lavender" | "sand";
export type NoteAlign = "left" | "center" | "right";
export type NoteSize = "small" | "medium" | "large";

export type Item = {
  id: string;
  kind: "image" | "note";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  locked: boolean;
  src?: string;
  text?: string;
  noteColor?: NoteColor;
  noteAlign?: NoteAlign;
  noteSize?: NoteSize;
  noteBold?: boolean;
  name: string;
};

export type Board = { version: 1; name: string; items: Item[] };
export type View = { x: number; y: number; zoom: number };
export type Bounds = { x: number; y: number; width: number; height: number };

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_BOARD_BYTES = 100 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 64;
const MAX_FIT_ZOOM = 4;

export function createBoard(): Board {
  return { version: 1, name: "Untitled board", items: [] };
}

export function supportedImage(file: { type: string; size: number }): boolean {
  return (
    IMAGE_TYPES.has(file.type) &&
    Number.isFinite(file.size) &&
    file.size > 0 &&
    file.size <= MAX_IMAGE_BYTES
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberIn(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function shortString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function safeImageSource(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64
  )
    return false;
  const match =
    /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (!match) return false;
  const encoded = match[2];
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return (
    encoded.length % 4 === 0 &&
    supportedImage({ type: match[1], size: (encoded.length / 4) * 3 - padding })
  );
}

/** Counts UTF-8 bytes without allocating a second copy of embedded images. */
export function utf8ByteLength(text: string): number {
  let bytes = text.length;
  for (const match of text.matchAll(/[^\u0000-\u007f]/gu)) {
    const point = match[0].codePointAt(0)!;
    bytes += point <= 0x7ff ? 1 : 2;
  }
  return bytes;
}

/** Rejects unsupported versions, corrupt geometry, executable URLs, and oversized inputs. */
export function parseBoard(text: string): Board {
  if (text.length > MAX_BOARD_BYTES || utf8ByteLength(text) > MAX_BOARD_BYTES)
    throw new Error("Board file exceeds the 100 MB limit.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This is not a valid board file.");
  }
  if (
    !record(value) ||
    value.version !== 1 ||
    !shortString(value.name, 200) ||
    !Array.isArray(value.items) ||
    value.items.length > 2000
  ) {
    throw new Error("Unsupported or invalid board format.");
  }
  const ids = new Set<string>();
  const items = value.items.map((item: unknown, index: number): Item => {
    const invalid = () => new Error(`Invalid item ${index + 1} in board file.`);
    if (
      !record(item) ||
      !shortString(item.id, 200) ||
      !item.id ||
      ids.has(item.id) ||
      (item.kind !== "image" && item.kind !== "note") ||
      !shortString(item.name, 500) ||
      !numberIn(item.x, -1_000_000, 1_000_000) ||
      !numberIn(item.y, -1_000_000, 1_000_000) ||
      !numberIn(item.width, 1, 100_000) ||
      !numberIn(item.height, 1, 100_000) ||
      !numberIn(item.rotation, -360_000, 360_000) ||
      typeof item.locked !== "boolean"
    )
      throw invalid();
    if (item.kind === "image" && !safeImageSource(item.src)) throw invalid();
    if (item.kind === "note" && !shortString(item.text, 100_000))
      throw invalid();
    if (item.kind === "note") {
      if (
        ("noteColor" in item &&
          !["yellow", "sage", "blue", "rose", "lavender", "sand"].includes(
            item.noteColor as string,
          )) ||
        ("noteAlign" in item &&
          !["left", "center", "right"].includes(item.noteAlign as string)) ||
        ("noteSize" in item &&
          !["small", "medium", "large"].includes(item.noteSize as string)) ||
        ("noteBold" in item && typeof item.noteBold !== "boolean")
      )
        throw invalid();
    }
    ids.add(item.id);
    // Explicitly reconstruct: unknown fields and object prototypes never enter app state.
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      rotation: item.rotation,
      locked: item.locked,
      ...(item.kind === "image"
        ? { src: item.src as string }
        : {
            text: item.text as string,
            ...("noteColor" in item
              ? { noteColor: item.noteColor as NoteColor }
              : {}),
            ...("noteAlign" in item
              ? { noteAlign: item.noteAlign as NoteAlign }
              : {}),
            ...("noteSize" in item
              ? { noteSize: item.noteSize as NoteSize }
              : {}),
            ...("noteBold" in item
              ? { noteBold: item.noteBold as boolean }
              : {}),
          }),
    };
  });
  return { version: 1, name: value.name, items };
}

export function serializeBoard(board: Board): string {
  return JSON.stringify(board);
}

function clone(board: Board): Board {
  return {
    version: 1,
    name: board.name,
    items: board.items.map((item) => ({ ...item })),
  };
}

function sameBoard(a: Board, b: Board): boolean {
  return (
    a.name === b.name &&
    a.version === b.version &&
    a.items.length === b.items.length &&
    a.items.every((item, index) => {
      const other = b.items[index];
      return (
        item.id === other.id &&
        item.kind === other.kind &&
        item.name === other.name &&
        item.x === other.x &&
        item.y === other.y &&
        item.width === other.width &&
        item.height === other.height &&
        item.rotation === other.rotation &&
        item.locked === other.locked &&
        item.src === other.src &&
        item.text === other.text &&
        item.noteColor === other.noteColor &&
        item.noteAlign === other.noteAlign &&
        item.noteSize === other.noteSize &&
        item.noteBold === other.noteBold
      );
    })
  );
}

/** Each entry owns its data; callers cannot mutate saved undo/redo snapshots. */
export class History {
  private entries: Board[];
  private index = 0;

  constructor(initial: Board) {
    this.entries = [clone(initial)];
  }
  get board(): Board {
    return clone(this.entries[this.index]);
  }
  get canUndo(): boolean {
    return this.index > 0;
  }
  get canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }

  commit(board: Board): void {
    if (sameBoard(board, this.entries[this.index])) return;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(clone(board));
    if (this.entries.length > 100) this.entries.shift();
    this.index = this.entries.length - 1;
  }

  undo(): Board {
    if (this.canUndo) this.index--;
    return this.board;
  }
  redo(): Board {
    if (this.canRedo) this.index++;
    return this.board;
  }
}

/** Axis-aligned bounds, accounting for rotation around each item's center. */
export function bounds(items: Item[]): Bounds | null {
  if (!items.length) return null;
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const item of items) {
    const angle = (item.rotation * Math.PI) / 180;
    const width =
      Math.abs(Math.cos(angle)) * item.width +
      Math.abs(Math.sin(angle)) * item.height;
    const height =
      Math.abs(Math.sin(angle)) * item.width +
      Math.abs(Math.cos(angle)) * item.height;
    const x = item.x + (item.width - width) / 2;
    const y = item.y + (item.height - height) / 2;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + width);
    bottom = Math.max(bottom, y + height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function fitView(items: Item[], width: number, height: number): View {
  const box = bounds(items);
  if (!box) return { x: width / 2, y: height / 2, zoom: 1 };
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(
      MAX_FIT_ZOOM,
      Math.max(1, width - 128) / box.width,
      Math.max(1, height - 128) / box.height,
    ),
  );
  return {
    x: width / 2 - (box.x + box.width / 2) * zoom,
    y: height / 2 - (box.y + box.height / 2) * zoom,
    zoom,
  };
}

/** Keeps the world coordinate under screenPoint stationary while zooming. */
export function zoomAt(
  view: View,
  screenPoint: { x: number; y: number },
  factor: number,
): View {
  if (!Number.isFinite(factor) || factor <= 0) return { ...view };
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor));
  const ratio = zoom / view.zoom;
  return {
    x: screenPoint.x - (screenPoint.x - view.x) * ratio,
    y: screenPoint.y - (screenPoint.y - view.y) * ratio,
    zoom,
  };
}

/** Deterministic rows with a 32-unit gap. Locked items are left in place. */
export function arrangeItems(items: Item[]): Item[] {
  const movable = items.filter((item) => !item.locked);
  if (!movable.length) return items.map((item) => ({ ...item }));
  const columns = Math.ceil(Math.sqrt(movable.length));
  const arranged = new Map<string, Item>();
  const origin = bounds(movable)!;
  let y = origin.y;
  for (let row = 0; row < movable.length; row += columns) {
    const group = movable.slice(row, row + columns);
    let x = origin.x;
    let rowHeight = 0;
    for (const item of group) {
      const extent = bounds([{ ...item, x: 0, y: 0 }])!;
      arranged.set(item.id, { ...item, x: x - extent.x, y: y - extent.y });
      x += extent.width + 32;
      rowHeight = Math.max(rowHeight, extent.height);
    }
    y += rowHeight + 32;
  }
  return items.map((item) => arranged.get(item.id) ?? { ...item });
}
