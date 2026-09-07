import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const isDesktop = isTauri();
let closeApproved = false;

export async function saveBoardFile(
  contents: string,
  suggestedName: string,
): Promise<boolean> {
  if (isDesktop)
    return invoke<boolean>("save_board_file", { contents, suggestedName });
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName.endsWith(".mindboard")
    ? suggestedName
    : `${suggestedName}.mindboard`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function openBoardFile(): Promise<string | null> {
  if (isDesktop) return invoke<string | null>("open_board_file");
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mindboard,.json,application/json";
    input.style.display = "none";
    const finish = () => input.remove();
    input.addEventListener(
      "cancel",
      () => {
        finish();
        resolve(null);
      },
      { once: true },
    );
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        finish();
        if (!file) {
          resolve(null);
          return;
        }
        if (file.size > 100 * 1024 * 1024) {
          reject(new Error("This board exceeds the 100 MB file limit."));
          return;
        }
        void file.text().then(resolve, reject);
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
  });
}

export async function setAlwaysOnTop(value: boolean): Promise<void> {
  if (isDesktop) await getCurrentWindow().setAlwaysOnTop(value);
}

export async function setFullscreen(value: boolean): Promise<void> {
  if (isDesktop) {
    await getCurrentWindow().setFullscreen(value);
    return;
  }
  if (value && !document.fullscreenElement)
    await document.documentElement.requestFullscreen();
  if (!value && document.fullscreenElement) await document.exitFullscreen();
}

export async function startWindowDrag(): Promise<void> {
  if (isDesktop) await getCurrentWindow().startDragging();
}

export async function minimizeWindow(): Promise<void> {
  if (isDesktop) await getCurrentWindow().minimize();
}

export async function closeWindow(): Promise<void> {
  if (!isDesktop) return;
  closeApproved = true;
  try {
    await getCurrentWindow().close();
  } catch (error) {
    closeApproved = false;
    throw error;
  }
}

export async function installCloseHandler(handler: () => void): Promise<void> {
  if (!isDesktop) return;
  await getCurrentWindow().onCloseRequested((event) => {
    if (!closeApproved) {
      event.preventDefault();
      handler();
    }
  });
}
