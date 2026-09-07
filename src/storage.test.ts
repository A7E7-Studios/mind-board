import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore, IDBDatabase } from "fake-indexeddb";
import { createBoard, type Board } from "./board";
import { loadRecovery, saveRecovery } from "./storage";

const noteBoard = (): Board => ({
  version: 1,
  name: "Recovery study",
  items: [
    {
      id: "note",
      kind: "note",
      name: "Palette",
      text: "日本語 🎨\nKeep this thought.",
      x: -20,
      y: 90,
      width: 280,
      height: 200,
      rotation: 90,
      locked: true,
    },
  ],
});

async function writeRawRecovery(value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("mindboard", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("boards");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("boards", "readwrite");
      tx.objectStore("boards").put(value, "current");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("local IndexedDB recovery", () => {
  it("starts without a recovery and round trips unicode, geometry and locks", async () => {
    expect(await loadRecovery()).toBeNull();
    const board = noteBoard();
    await saveRecovery(board);
    expect(await loadRecovery()).toEqual(board);
    board.items[0].text = "caller mutation";
    expect((await loadRecovery())?.items[0].text).toContain(
      "Keep this thought.",
    );
  });

  it("replaces recovery with the newest board including an empty new board", async () => {
    await saveRecovery(noteBoard());
    const next = { ...noteBoard(), name: "Renamed board" };
    await saveRecovery(next);
    expect(await loadRecovery()).toEqual(next);
    await saveRecovery(createBoard());
    expect(await loadRecovery()).toEqual(createBoard());
  });

  it.each([
    "{broken",
    '{"version":999,"name":"future","items":[]}',
    JSON.stringify({
      ...noteBoard(),
      items: [{ ...noteBoard().items[0], width: -1 }],
    }),
  ])("rejects corrupt or unsupported recovery data", async (contents) => {
    await writeRawRecovery(contents);
    await expect(loadRecovery()).rejects.toThrow();
  });

  it("treats a non-string recovery value as unavailable", async () => {
    await writeRawRecovery({ unrelated: true });
    expect(await loadRecovery()).toBeNull();
  });

  it("reports quota failures while retaining the last successful recovery", async () => {
    await saveRecovery(noteBoard());
    const write = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      });
    await expect(saveRecovery(createBoard())).rejects.toMatchObject({
      name: "QuotaExceededError",
    });
    write.mockRestore();
    expect(await loadRecovery()).toEqual(noteBoard());
  });

  it("reports aborted transactions and preserves previous data", async () => {
    await saveRecovery(noteBoard());
    const original = IDBDatabase.prototype.transaction;
    const transaction = vi
      .spyOn(IDBDatabase.prototype, "transaction")
      .mockImplementationOnce(function (
        this: IDBDatabase,
        ...args: Parameters<typeof original>
      ) {
        const tx = original.apply(this, args);
        queueMicrotask(() => tx.abort());
        return tx;
      });
    await expect(saveRecovery(createBoard())).rejects.toThrow();
    transaction.mockRestore();
    expect(await loadRecovery()).toEqual(noteBoard());
  });

  it("propagates unavailable storage without claiming a successful save", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    await expect(loadRecovery()).rejects.toMatchObject({
      name: "SecurityError",
    });
    await expect(saveRecovery(noteBoard())).rejects.toMatchObject({
      name: "SecurityError",
    });
  });
});
