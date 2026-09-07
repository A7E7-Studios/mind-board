import { describe, expect, it } from "vitest";
import {
  arrangeItems,
  bounds,
  createBoard,
  fitView,
  History,
  MAX_BOARD_BYTES,
  parseBoard,
  serializeBoard,
  supportedImage,
  utf8ByteLength,
  zoomAt,
  type Board,
  type Item,
} from "./board";

const image = (extra: Partial<Item> = {}): Item => ({
  id: "image-1",
  kind: "image",
  name: "Reference",
  x: 20,
  y: 40,
  width: 200,
  height: 100,
  rotation: 0,
  locked: false,
  src: "data:image/png;base64,iVBORw0KGgo=",
  ...extra,
});
const board = (items: Item[] = [image()]): Board => ({
  version: 1,
  name: "Studio references",
  items,
});
const rasterPayload = (bytes: number): string => {
  const padding = (3 - (bytes % 3)) % 3;
  return `data:image/png;base64,${"A".repeat(Math.ceil(bytes / 3) * 4 - padding)}${"=".repeat(padding)}`;
};

describe("portable board format", () => {
  it.each([
    "simple ASCII",
    "café",
    "日本語",
    "🎨 Mood",
    "\ud800",
    "\udfff",
    "a\u0000b",
  ])("counts UTF-8 bytes accurately for %j", (text) => {
    expect(utf8ByteLength(text)).toBe(
      new TextEncoder().encode(text).byteLength,
    );
  });

  it("rejects files exceeding the byte limit even when JS character length fits", () => {
    const text = `{"version":1,"name":"${" ".repeat(MAX_BOARD_BYTES - 100)}${"🎨".repeat(25)}","items":[]}`;
    expect(text.length).toBeLessThan(MAX_BOARD_BYTES);
    expect(() => parseBoard(text)).toThrow("100 MB");
  });

  it("parses a full 20 MiB raster payload without regexp stack failures", () => {
    const source = rasterPayload(20 * 1024 * 1024);
    const parsed = parseBoard(serializeBoard(board([image({ src: source })])));
    expect(parsed.items[0].src).toBe(source);
  });

  it("rejects a raster one byte over the decoded limit", () => {
    expect(() =>
      parseBoard(
        serializeBoard(
          board([image({ src: rasterPayload(20 * 1024 * 1024 + 1) })]),
        ),
      ),
    ).toThrow("Invalid item");
  });

  it("rejects composed boards over 100 MiB although each raster is supported", () => {
    const source = rasterPayload(19 * 1024 * 1024);
    const text = serializeBoard(
      board(
        Array.from({ length: 4 }, (_, index) =>
          image({ id: `${index}`, src: source }),
        ),
      ),
    );
    expect(text.length).toBeGreaterThan(MAX_BOARD_BYTES);
    expect(() => parseBoard(text)).toThrow("100 MB");
  });
  it("round trips images and multiline notes without losing unicode", () => {
    const original = board([
      image(),
      image({
        id: "note",
        kind: "note",
        text: "色彩\nMood & light",
        src: undefined,
      }),
    ]);
    expect(parseBoard(serializeBoard(original))).toEqual(original);
    expect(parseBoard(serializeBoard(createBoard()))).toEqual(createBoard());
  });

  it.each([
    "not json",
    "null",
    "[]",
    "{}",
    '{"version":2,"name":"future","items":[]}',
  ])("rejects malformed format %s", (value) => {
    expect(() => parseBoard(value)).toThrow();
  });

  it.each([
    { width: 0 },
    { height: -1 },
    { width: 100_001 },
    { x: 1_000_001 },
    { y: null },
    { rotation: "90" },
    { locked: 1 },
    { id: "" },
    { kind: "iframe" },
    { name: "n".repeat(501) },
    { src: "https://example.com/a.png" },
    { src: "javascript:alert(1)" },
    { src: "data:image/svg+xml;base64,PHN2Zy8+" },
    { src: "data:text/html;base64,PHN2Zy8+" },
    { src: "data:image/png;base64," },
    { src: "data:image/png;base64,abc" },
    { src: "data:image/png;base64,====" },
    { src: "data:image/png;base64,YQ==\n" },
    { kind: "note", text: null },
    { kind: "note", text: "n".repeat(100_001) },
  ])("rejects invalid or unsafe item %j", (mutation) => {
    expect(() =>
      parseBoard(JSON.stringify(board([{ ...image(), ...mutation } as Item]))),
    ).toThrow();
  });

  it("rejects duplicate IDs, too many items, and non-finite geometry", () => {
    expect(() =>
      parseBoard(serializeBoard(board([image(), image()]))),
    ).toThrow();
    expect(() =>
      parseBoard(
        serializeBoard(
          board(Array.from({ length: 2001 }, (_, i) => image({ id: `${i}` }))),
        ),
      ),
    ).toThrow();
    expect(() =>
      parseBoard(serializeBoard(board()).replace('"x":20', '"x":1e999')),
    ).toThrow();
  });

  it("discards unknown properties and image sources on notes", () => {
    const text = JSON.stringify({
      ...board(),
      unexpected: true,
      items: [{ ...image({ kind: "note", text: "hello" }), evil: "<script>" }],
    });
    expect(parseBoard(text)).toEqual(
      board([
        {
          id: "image-1",
          kind: "note",
          name: "Reference",
          x: 20,
          y: 40,
          width: 200,
          height: 100,
          rotation: 0,
          locked: false,
          text: "hello",
        },
      ]),
    );
  });
});

describe("image support", () => {
  it.each(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"])(
    "accepts %s up to the exact size limit",
    (type) => {
      expect(supportedImage({ type, size: 20 * 1024 * 1024 })).toBe(true);
      expect(supportedImage({ type, size: 20 * 1024 * 1024 + 1 })).toBe(false);
    },
  );
  it("rejects executable formats and invalid sizes", () => {
    expect(supportedImage({ type: "image/svg+xml", size: 500 })).toBe(false);
    for (const size of [0, -1, Infinity, NaN])
      expect(supportedImage({ type: "image/png", size })).toBe(false);
  });
});

describe("undo history", () => {
  it("undoes, redoes, ignores no-ops, and truncates future edits after branching", () => {
    const history = new History(createBoard());
    expect(history.canUndo).toBe(false);
    expect(history.undo()).toEqual(createBoard());
    history.commit(board());
    history.commit(board());
    history.commit(board([image({ x: 400 })]));
    expect(history.undo()).toEqual(board());
    expect(history.canRedo).toBe(true);
    expect(history.redo().items[0].x).toBe(400);
    history.undo();
    history.commit(board([image({ x: -200 })]));
    expect(history.canRedo).toBe(false);
    expect(history.redo().items[0].x).toBe(-200);
    expect(history.undo()).toEqual(board());
    expect(history.undo()).toEqual(createBoard());
    expect(history.canUndo).toBe(false);
  });

  it("isolates constructor, commit, getter, and undo snapshots from mutations", () => {
    const initial = board();
    const history = new History(initial);
    initial.items[0].x = 999;
    history.board.items[0].x = 888;
    expect(history.board.items[0].x).toBe(20);
    const next = board([image({ x: 100 })]);
    history.commit(next);
    next.items[0].x = 777;
    const old = history.undo();
    old.items.length = 0;
    expect(history.board.items.length).toBe(1);
    expect(history.redo().items[0].x).toBe(100);
  });

  it("bounds history memory to 100 snapshots", () => {
    const history = new History(createBoard());
    for (let i = 0; i < 110; i++) history.commit(board([image({ x: i })]));
    let steps = 0;
    while (history.canUndo) {
      history.undo();
      steps++;
    }
    expect(steps).toBe(99);
    expect(history.board.items[0].x).toBe(10);
  });
});

describe("canvas geometry", () => {
  it("measures rotated bounds and negative coordinates", () => {
    expect(bounds([])).toBeNull();
    const box = bounds([image({ rotation: 90, x: -200, y: -100 })])!;
    expect(box.x).toBeCloseTo(-150);
    expect(box.y).toBeCloseTo(-150);
    expect(box.width).toBeCloseTo(100);
    expect(box.height).toBeCloseTo(200);
  });

  it("fits all references within padding and centers their bounds", () => {
    const items = [image({ x: -200 }), image({ id: "2", x: 800, y: 500 })];
    const view = fitView(items, 1000, 700);
    const box = bounds(items)!;
    expect(box.x * view.zoom + view.x).toBeGreaterThanOrEqual(63.99);
    expect((box.x + box.width) * view.zoom + view.x).toBeLessThanOrEqual(
      936.01,
    );
    expect((box.y + box.height / 2) * view.zoom + view.y).toBeCloseTo(350);
    expect(fitView([], 1000, 700)).toEqual({ x: 500, y: 350, zoom: 1 });
  });

  it("keeps the pointer anchored through zooming and clamps extreme zooms", () => {
    const view = { x: 40, y: -80, zoom: 1.5 };
    const point = { x: 400, y: 220 };
    const changed = zoomAt(view, point, 2);
    expect((point.x - changed.x) / changed.zoom).toBeCloseTo(
      (point.x - view.x) / view.zoom,
    );
    expect((point.y - changed.y) / changed.zoom).toBeCloseTo(
      (point.y - view.y) / view.zoom,
    );
    expect(zoomAt(view, point, 1000).zoom).toBe(4);
    expect(zoomAt(view, point, 0.0001).zoom).toBe(0.1);
    expect(zoomAt(view, point, NaN)).toEqual(view);
  });

  it("arranges references without overlap or size changes and preserves locks", () => {
    const items = [
      image({ rotation: 35 }),
      image({ id: "2", width: 800, height: 60 }),
      image({ id: "3", rotation: 90 }),
      image({ id: "lock", locked: true, x: 5000 }),
    ];
    const before = serializeBoard(board(items));
    const result = arrangeItems(items);
    expect(serializeBoard(board(items))).toBe(before);
    expect(arrangeItems(items)).toEqual(result);
    expect(result[3]).toEqual(items[3]);
    result.forEach((item, i) => {
      expect(item.width).toBe(items[i].width);
      expect(item.height).toBe(items[i].height);
    });
    const boxes = result.slice(0, 3).map((item) => bounds([item])!);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        expect(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
        ).toBe(true);
      }
    expect(arrangeItems([])).toEqual([]);
  });
});
