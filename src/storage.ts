import { parseBoard, serializeBoard, type Board } from "./board";

const DB_NAME = "mindboard";
const STORE = "boards";
function connect(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadRecovery(): Promise<Board | null> {
  const db = await connect();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get("current");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return typeof value === "string" ? parseBoard(value) : null;
  } finally {
    db.close();
  }
}
export async function saveRecovery(board: Board): Promise<void> {
  const contents = serializeBoard(board);
  const db = await connect();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(contents, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error ?? new Error("Recovery write cancelled"));
    });
  } finally {
    db.close();
  }
}
