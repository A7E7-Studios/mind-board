import "./style.css";
import {
  createBoard,
  parseBoard,
  serializeBoard,
  History,
  bounds,
  fitView,
  zoomAt,
  arrangeItems,
  supportedImage,
  type Board,
  type Item,
  type View,
} from "./board";
import { loadRecovery, saveRecovery } from "./storage";
import {
  isDesktop,
  openBoardFile,
  saveBoardFile,
  setAlwaysOnTop,
  setFullscreen,
  startWindowDrag,
  minimizeWindow,
  closeWindow,
  installCloseHandler,
} from "./platform";
import { icon } from "./icons";

const button = (label: string, glyph: string, action: string, extra = "") =>
  `<button type="button" aria-label="${label}" title="${label}" data-action="${action}" ${extra}>${icon(glyph)}</button>`;
document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main id="workspace" class="focus-mode">
    <header class="topbar">
      <a class="brand" href="#" aria-label="MindBoard home"><span class="brand-mark"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 19V5l8 9 8-9v14" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg></span><span>mindboard<span class="version"> / 01</span></span></a>
      <span class="header-divider"></span>
      <input id="board-name" aria-label="Board name" maxlength="120" value="Untitled board" spellcheck="false" />
      <span class="local-badge"><span></span> LOCAL SPACE</span>
      <div class="header-actions">${button("Open board", "folder", "open")}<button class="save-button" data-action="save" aria-label="Save board" title="Save board · Ctrl+S">${icon("save")}<span>Save board</span></button>${button("Board menu", "more", "menu", 'aria-expanded="false" aria-controls="board-menu"')}</div>
    </header>
    <div id="board-menu" class="menu" hidden>
      <button data-action="new" aria-label="New board">New board <kbd>Ctrl N</kbd></button>
      <button data-action="focus" aria-label="Focus mode">Focus mode <kbd>Tab</kbd></button>
      <button data-action="fullscreen" aria-label="Fullscreen">Fullscreen <kbd>F11</kbd></button>
      ${isDesktop ? '<button data-action="pin" aria-pressed="false">Always on top</button>' : ""}
      <div class="menu-divider"></div><button data-action="help" aria-label="Keyboard shortcuts">Keyboard shortcuts <kbd>?</kbd></button>
      <p>MindBoard 0.1.0 · MIT licensed</p>
    </div>
    <section id="canvas" data-testid="canvas" aria-label="Reference board canvas" tabindex="0">
      <div id="world" role="listbox" aria-label="References" aria-multiselectable="true"></div>
      <div id="empty-state">
        <div class="minimal-empty"><button data-action="import" aria-label="Import images">${icon("image")}<span>Drop images here</span></button><p>Right-click for tools <span>·</span> Tab to show controls</p></div>
        <div class="empty-art" aria-hidden="true"><div class="art-card art-back"><span></span></div><div class="art-card art-middle"><span></span></div><div class="art-card art-front">${icon("image")}<i></i></div><span class="art-spark">+</span></div>
        <p class="eyebrow">ROOM TO THINK</p><h1>A quiet place for<br>your references.</h1>
        <p class="empty-description">Bring your inspiration together.<br>Drop images anywhere, and make space for ideas.</p>
        <button class="primary" data-action="import">${icon("plus")}<span>Import images</span><kbd>I</kbd></button>
        <span class="empty-formats">PNG, JPG, WebP, GIF & AVIF · or paste an image</span>
      </div>
      <div id="marquee" hidden></div>
      <div id="drop-overlay" hidden>${icon("image")}<strong>Drop your references here</strong><span>Images stay on your device</span></div>
    </section>
    <div id="selection-tools" class="floating-bar selection-tools" hidden aria-label="Selection actions">
      <span id="selection-count"></span><span class="tool-divider"></span>
      ${button("Duplicate", "copy", "duplicate")}${button("Arrange", "grid", "arrange")}${button("Rotate left", "rotate", "rotate-left")}${button("Rotate right", "rotate", "rotate-right", 'class="mirror-icon"')}${button("Lock selection", "lock", "lock")}${button("Bring to front", "front", "front")}${button("Send to back", "back", "back")}<span class="tool-divider"></span>${button("Delete", "trash", "delete", 'class="danger"')}
    </div>
    <div class="bottom-controls">
      <div class="floating-bar create-tools">${button("Import images", "image", "import")}${button("Add note", "note", "note")}<span class="tool-divider"></span>${button("Undo", "undo", "undo")}${button("Redo", "redo", "redo")}</div>
      <div class="navigation-hint"><kbd>Space</kbd> to pan <span>·</span> Scroll to zoom</div>
      <div class="floating-bar zoom-tools">${button("Zoom out", "minus", "zoom-out")}<button data-action="reset-zoom" aria-label="Reset zoom" title="Reset zoom · 1" id="zoom-label">100%</button>${button("Zoom in", "plus", "zoom-in")}<span class="tool-divider"></span>${button("Fit all", "fit", "fit")}</div>
    </div>
    <footer><div><span class="status-dot"></span><span id="save-status" role="status">Ready</span></div><span id="item-count">0 references</span><button data-action="help" aria-label="Keyboard shortcuts" title="Keyboard shortcuts · ?">${icon("help")}</button></footer>
    <button id="exit-focus" data-action="focus" aria-label="Show controls" title="Show controls · Tab">${icon("more")}</button>
    <div id="context-menu" class="menu context-menu" role="menu" aria-label="Board tools" hidden></div>
    <div id="toast" role="status" hidden></div>
    <input id="image-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple hidden />
    <dialog id="note-dialog"><form method="dialog" id="note-form"><div class="dialog-heading"><h2 id="note-title">Add a note</h2><button value="cancel" aria-label="Close note" formnovalidate>${icon("close")}</button></div><p>A thought, a direction, a little context.</p><textarea aria-label="Note text" id="note-text" placeholder="What’s on your mind?" maxlength="10000" required rows="6"></textarea><div class="dialog-actions"><button value="cancel" formnovalidate>Cancel</button><button class="primary" id="note-submit" value="save">Add note</button></div></form></dialog>
    <dialog id="help-dialog"><div class="dialog-heading"><div><p class="eyebrow">MAKE YOURSELF AT HOME</p><h2>Less clicking. More creating.</h2></div><button data-action="close-help" aria-label="Close shortcuts">${icon("close")}</button></div><div class="shortcut-grid">${[
      ["Import images", "I"],
      ["Add a note", "N"],
      ["Pan around", "Space + drag"],
      ["Zoom at cursor", "Scroll"],
      ["Select multiple", "Shift + click"],
      ["Select an area", "Drag empty canvas"],
      ["Select all", "Ctrl / ⌘ A"],
      ["Duplicate", "Ctrl / ⌘ D"],
      ["Delete selection", "Delete"],
      ["Undo / redo", "Ctrl / ⌘ Z / Shift Z"],
      ["Fit all references", "F"],
      ["Actual size", "1"],
      ["Open / save board", "Ctrl / ⌘ O / S"],
      ["New board", "Ctrl / ⌘ N"],
      ["Show / hide controls", "Tab"],
      ["Tools menu", "Right-click / Shift F10"],
      ...(isDesktop
        ? [
            ["Move window", "Alt + drag"],
            ["Close window", "Ctrl / ⌘ Q"],
          ]
        : []),
      ["Fullscreen", "F11"],
      ["Close / deselect", "Esc"],
      ["Show shortcuts", "?"],
    ]
      .map(
        ([label, key]) => `<div><span>${label}</span><kbd>${key}</kbd></div>`,
      )
      .join(
        "",
      )}</div><p class="help-footer">Your images stay on this device. No accounts. No cloud. Just your ideas.</p></dialog>
    <dialog id="confirm-dialog"><h2>Start a fresh board?</h2><p>The current board’s recovery will be replaced.<br>Save a board file first if you want to keep it.</p><div class="dialog-actions"><button data-action="cancel-new">Cancel</button><button class="primary" data-action="confirm-new">New board</button></div></dialog>
    <dialog id="close-dialog"><h2>Keep your changes before closing</h2><p>Local recovery could not save your latest changes. Save a board file to keep them.</p><div class="dialog-actions"><button data-action="cancel-close">Cancel</button><button data-action="discard-close">Close without saving</button><button class="primary" data-action="save-close">Save and close</button></div></dialog>
  </main>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const canvas = $("#canvas");
const world = $("#world");
const nameInput = $<HTMLInputElement>("#board-name");
let history = new History(createBoard());
let view: View = { x: 0, y: 0, zoom: 1 };
let selected = new Set<string>();
let preview: Board | null = null;
let spaceDown = false;
let focusMode = true;
let windowMoveArmed = false;
let contextPoint: { x: number; y: number } | null = null;
let importPoint: { x: number; y: number } | null = null;
let notePoint: { x: number; y: number } | null = null;
let pinned = false;
let fullscreen = false;
let noteId: string | null = null;
let toastTimer: ReturnType<typeof setTimeout>;
let persistQueue = Promise.resolve();
let revision = 0;
let recoveredRevision = 0;
let exportedRevision = -1;
let importQueue = Promise.resolve();
let documentGeneration = 0;
let ready = false;
const getBoard = () => preview ?? history.board;
const isEditing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('input,textarea,[contenteditable="true"],dialog');
function toast(message: string) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 4500);
}
function persist() {
  const board = history.board;
  const current = ++revision;
  $("#save-status").textContent = "Saving locally…";
  persistQueue = persistQueue
    .catch(() => {})
    .then(() => saveRecovery(board))
    .then(() => {
      recoveredRevision = current;
      if (revision === current)
        $("#save-status").textContent = "Saved on this device";
    })
    .catch(() => {
      if (revision === current)
        $("#save-status").textContent =
          "Recovery unavailable — save a board file";
      toast(
        "Local recovery is unavailable. Save a board file to keep your work.",
      );
    });
}
function commit(board: Board) {
  // Keep every accepted edit portable and recoverable using the same schema.
  // Validate before changing history, so failures leave the last good board intact.
  try {
    parseBoard(serializeBoard(board));
  } catch (error) {
    preview = null;
    render();
    toast(`Change was not applied: ${(error as Error).message}`);
    return false;
  }
  preview = null;
  history.commit(board);
  selected = new Set(
    [...selected].filter((id) => board.items.some((item) => item.id === id)),
  );
  render();
  persist();
  return true;
}
function changeItems(change: (items: Item[]) => Item[]) {
  return commit({ ...history.board, items: change(history.board.items) });
}
function localPoint(e: { clientX: number; clientY: number }) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function worldPoint(p: { x: number; y: number }) {
  return { x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom };
}
function center() {
  return worldPoint({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 });
}
function renderView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  canvas.style.setProperty("--grid-size", `${32 * view.zoom}px`);
  canvas.style.setProperty("--grid-x", `${view.x}px`);
  canvas.style.setProperty("--grid-y", `${view.y}px`);
  world.style.setProperty("--inverse-zoom", `${1 / view.zoom}`);
  $("#zoom-label").textContent = `${Math.round(view.zoom * 100)}%`;
}
function render() {
  const board = getBoard();
  nameInput.value = board.name;
  document.title = `${board.name} — MindBoard`;
  const existing = new Map(
    Array.from(world.children).map((el) => [
      (el as HTMLElement).dataset.id,
      el as HTMLElement,
    ]),
  );
  for (const [index, item] of board.items.entries()) {
    let node = existing.get(item.id);
    if (node && node.dataset.kind !== item.kind) {
      node.remove();
      node = undefined;
    }
    if (!node) {
      node = document.createElement("div");
      node.dataset.id = item.id;
      node.dataset.kind = item.kind;
      node.dataset.testid = "board-item";
      const content = document.createElement(
        item.kind === "image" ? "img" : "div",
      );
      content.className = "item-content";
      if (content instanceof HTMLImageElement) {
        content.draggable = false;
        content.alt = item.name;
        content.src = item.src!;
      }
      node.append(content);
    }
    node.className = `board-item ${item.kind}${selected.has(item.id) ? " selected" : ""}${item.locked ? " locked" : ""}`;
    node.setAttribute("aria-label", item.name);
    node.setAttribute("aria-selected", String(selected.has(item.id)));
    node.setAttribute("role", "option");
    if (item.kind === "image") {
      const img = node.querySelector<HTMLImageElement>("img")!;
      if (img.getAttribute("src") !== item.src) img.src = item.src!;
      img.alt = item.name;
    }
    Object.assign(node.style, {
      left: `${item.x}px`,
      top: `${item.y}px`,
      width: `${item.width}px`,
      height: `${item.height}px`,
      transform: `rotate(${item.rotation}deg)`,
    });
    if (item.kind === "note")
      node.querySelector(".item-content")!.textContent = item.text ?? "";
    node.querySelector(".resize-handle")?.remove();
    node.querySelector(".lock-badge")?.remove();
    if (selected.has(item.id) && !item.locked) {
      const handle = document.createElement("div");
      handle.className = "resize-handle";
      handle.dataset.testid = "resize-handle";
      handle.setAttribute("aria-label", "Resize reference");
      node.append(handle);
    }
    if (item.locked) {
      const lock = document.createElement("span");
      lock.className = "lock-badge";
      lock.innerHTML = icon("lock");
      node.append(lock);
    }
    if (world.children[index] !== node)
      world.insertBefore(node, world.children[index] ?? null);
    existing.delete(item.id);
  }
  existing.forEach((node) => node.remove());
  $("#empty-state").hidden = board.items.length > 0;
  $("#selection-tools").hidden = selected.size === 0;
  $("#selection-count").textContent = `${selected.size} selected`;
  $("#item-count").textContent =
    `${board.items.length} reference${board.items.length === 1 ? "" : "s"}`;
  $<HTMLButtonElement>('[data-action="undo"]').disabled = !history.canUndo;
  $<HTMLButtonElement>('[data-action="redo"]').disabled = !history.canRedo;
  const allLocked = board.items
    .filter((i) => selected.has(i.id))
    .every((i) => i.locked);
  const lockButton = $('[data-action="lock"]');
  lockButton.setAttribute(
    "aria-pressed",
    String(selected.size > 0 && allLocked),
  );
  lockButton.title = allLocked ? "Unlock selection" : "Lock selection";
  renderView();
}
function fit(items = history.board.items) {
  if (!items.length) {
    view = { x: 0, y: 0, zoom: 1 };
  } else {
    view = fitView(items, canvas.clientWidth, canvas.clientHeight);
  }
  renderView();
}
async function readImage(
  file: File,
): Promise<{ src: string; width: number; height: number }> {
  if (!supportedImage(file))
    throw new Error(
      `${file.name}: use PNG, JPG, WebP, GIF or AVIF under 20 MB.`,
    );
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    throw new Error(`${file.name}: this image could not be decoded.`);
  }
  if (img.naturalWidth * img.naturalHeight > 80_000_000)
    throw new Error(`${file.name}: image exceeds 80 megapixels.`);
  const scale = Math.min(
    1,
    Math.max(
      480 / Math.max(img.naturalWidth, img.naturalHeight),
      1 / Math.min(img.naturalWidth, img.naturalHeight),
    ),
  );
  return {
    src,
    width: img.naturalWidth * scale,
    height: img.naturalHeight * scale,
  };
}
function importImages(files: File[], at = center()) {
  const generation = documentGeneration;
  importQueue = importQueue
    .catch(() => {})
    .then(async () => {
      if (generation !== documentGeneration) return;
      const newItems: Item[] = [];
      let failed = "";
      for (const file of files) {
        try {
          const image = await readImage(file);
          newItems.push({
            id: crypto.randomUUID(),
            kind: "image",
            name: file.name,
            ...image,
            x: at.x - image.width / 2 + newItems.length * 28,
            y: at.y - image.height / 2 + newItems.length * 28,
            rotation: 0,
            locked: false,
          });
        } catch (error) {
          failed = (error as Error).message;
        }
      }
      if (generation !== documentGeneration) return;
      if (history.board.items.length + newItems.length > 2000) {
        toast("A board can contain up to 2,000 references.");
        return;
      }
      if (newItems.length) {
        finishGesture(false);
        selected = new Set(newItems.map((i) => i.id));
        try {
          if (changeItems((items) => [...items, ...newItems]))
            toast(
              failed
                ? `Added ${newItems.length} reference(s). ${failed}`
                : `Added ${newItems.length} reference${newItems.length === 1 ? "" : "s"}`,
            );
          else {
            selected.clear();
            render();
          }
        } catch (error) {
          selected.clear();
          render();
          toast(`Could not import images: ${(error as Error).message}`);
        }
      } else {
        toast(failed || "Drop or paste an image file to add a reference.");
      }
    });
  return importQueue;
}
function editNote(item?: Item) {
  noteId = item?.id ?? null;
  $("#note-title").textContent = item ? "Edit note" : "Add a note";
  $("#note-submit").textContent = item ? "Update note" : "Add note";
  $<HTMLTextAreaElement>("#note-text").value = item?.text ?? "";
  $<HTMLDialogElement>("#note-dialog").showModal();
  $<HTMLTextAreaElement>("#note-text").focus();
}
function noteHeight(text: string, width: number): number {
  const measure = document.createElement("div");
  Object.assign(measure.style, {
    position: "fixed",
    visibility: "hidden",
    width: `${width}px`,
    padding: "21px 23px",
    font: '21px / 1.45 Georgia, "Times New Roman", serif',
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  });
  measure.textContent = text;
  document.body.append(measure);
  const height = Math.max(
    200,
    Math.ceil(measure.getBoundingClientRect().height) + 8,
  );
  measure.remove();
  return height;
}
function manipulate(action: string) {
  const board = history.board;
  const targets = board.items.filter((i) => selected.has(i.id));
  if (!targets.length) return;
  if (action === "duplicate") {
    if (board.items.length + targets.length > 2000) {
      toast("A board can contain up to 2,000 references.");
      return;
    }
    const clones = targets.map((i) => ({
      ...i,
      id: crypto.randomUUID(),
      x: i.x + 32,
      y: i.y + 32,
      locked: false,
    }));
    selected = new Set(clones.map((i) => i.id));
    changeItems((items) => [...items, ...clones]);
  } else if (action === "delete") {
    const removable = new Set(
      targets.filter((i) => !i.locked).map((i) => i.id),
    );
    if (removable.size)
      changeItems((items) => items.filter((i) => !removable.has(i.id)));
    else toast("Unlock references before deleting them.");
  } else if (action === "arrange") {
    const arranged = new Map(arrangeItems(targets).map((i) => [i.id, i]));
    changeItems((items) => items.map((i) => arranged.get(i.id) ?? i));
  } else if (action === "lock") {
    const lock = !targets.every((i) => i.locked);
    changeItems((items) =>
      items.map((i) => (selected.has(i.id) ? { ...i, locked: lock } : i)),
    );
  } else if (action === "front" || action === "back") {
    const movable = new Set(targets.filter((i) => !i.locked).map((i) => i.id));
    changeItems((items) =>
      action === "front"
        ? [
            ...items.filter((i) => !movable.has(i.id)),
            ...items.filter((i) => movable.has(i.id)),
          ]
        : [
            ...items.filter((i) => movable.has(i.id)),
            ...items.filter((i) => !movable.has(i.id)),
          ],
    );
  } else if (action.startsWith("rotate-")) {
    changeItems((items) =>
      items.map((i) =>
        selected.has(i.id) && !i.locked
          ? {
              ...i,
              rotation:
                (i.rotation + (action === "rotate-left" ? -90 : 90)) % 360,
            }
          : i,
      ),
    );
  }
}
function hideContextMenu(restoreFocus = false) {
  $("#context-menu").hidden = true;
  contextPoint = null;
  if (restoreFocus) canvas.focus({ preventScroll: true });
}
function cancelWindowMove() {
  windowMoveArmed = false;
  canvas.classList.remove("move-window");
}

function showContextMenu(point: { x: number; y: number }, keyboard = false) {
  if (!ready) return;
  finishGesture(false);
  if (!keyboard) {
    const node = document
      .elementFromPoint(point.x, point.y)
      ?.closest<HTMLElement>(".board-item");
    if (node?.dataset.id) {
      if (!selected.has(node.dataset.id)) selected = new Set([node.dataset.id]);
    } else selected.clear();
    render();
  }
  contextPoint = worldPoint(localPoint({ clientX: point.x, clientY: point.y }));
  $("#board-menu").hidden = true;
  $('[data-action="menu"]').setAttribute("aria-expanded", "false");
  const menu = $("#context-menu");
  const entry = (
    label: string,
    glyph: string,
    name: string,
    key = "",
    disabled = false,
  ) =>
    `<button role="menuitem" type="button" aria-label="${label}" data-action="${name}" ${disabled ? "disabled" : ""}>${icon(glyph)}<span>${label}</span>${key ? `<kbd>${key}</kbd>` : ""}</button>`;
  const divider = '<div class="menu-divider" role="separator"></div>';
  const targets = history.board.items.filter((i) => selected.has(i.id));
  const locked = targets.length > 0 && targets.every((i) => i.locked);
  menu.innerHTML =
    `<div class="context-heading">${selected.size ? `${selected.size} selected` : "MindBoard"}</div>` +
    (selected.size
      ? `<div class="context-selection">${entry("Duplicate", "copy", "duplicate", "Ctrl D")}${entry("Delete", "trash", "delete", "Del", locked)}${entry("Arrange", "grid", "arrange")}${entry(locked ? "Unlock selection" : "Lock selection", "lock", "lock")}${entry("Rotate left", "rotate", "rotate-left", "", locked)}${entry("Rotate right", "rotate", "rotate-right", "", locked)}${entry("Bring to front", "front", "front", "", locked)}${entry("Send to back", "back", "back", "", locked)}</div>${divider}`
      : "") +
    entry("Import images", "image", "import", "I") +
    entry("Add note", "note", "note", "N") +
    divider +
    entry("Open board", "folder", "open", "Ctrl O") +
    entry("Save board", "save", "save", "Ctrl S") +
    entry("New board", "plus", "new", "Ctrl N") +
    divider +
    `<div class="context-pair">${entry("Undo", "undo", "undo", "", !history.canUndo)}${entry("Redo", "redo", "redo", "", !history.canRedo)}</div>` +
    divider +
    entry("Fit all", "fit", "fit", "F") +
    entry("Reset zoom", "plus", "reset-zoom", "1") +
    entry(
      focusMode ? "Show controls" : "Hide controls",
      "focus",
      "focus",
      "Tab",
    ) +
    entry("Fullscreen", "focus", "fullscreen", "F11") +
    (isDesktop
      ? entry(pinned ? "Always on top: on" : "Always on top", "pin", "pin") +
        divider +
        entry("Move window", "move", "move-window", "Alt drag") +
        `<div class="context-pair">${entry("Minimize", "minus", "minimize")}${entry("Close window", "close", "close-window")}</div>`
      : "") +
    divider +
    entry("Keyboard shortcuts", "help", "help", "?");
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(point.x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(point.y, window.innerHeight - rect.height - 8))}px`;
  menu.scrollTop = 0;
  menu
    .querySelector<HTMLButtonElement>("button:not(:disabled)")
    ?.focus({ preventScroll: true });
}

async function action(name: string) {
  if (!ready) return;
  finishGesture(false);
  const at = contextPoint;
  if (!$("#context-menu").hidden) hideContextMenu(true);
  if (name !== "menu") {
    $("#board-menu").hidden = true;
    $('[data-action="menu"]').setAttribute("aria-expanded", "false");
  }
  try {
    switch (name) {
      case "import":
        importPoint = at;
        $<HTMLInputElement>("#image-input").click();
        break;
      case "note":
        notePoint = at;
        editNote();
        break;
      case "save": {
        await importQueue;
        nameInput.blur();
        const board = history.board;
        const fileRevision = revision;
        if (
          await saveBoardFile(
            serializeBoard(board),
            `${board.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "Untitled board"}.mindboard`,
          )
        ) {
          exportedRevision = fileRevision;
          toast("Board file saved. Your images are included.");
        }
        break;
      }
      case "open": {
        const text = await openBoardFile();
        if (text === null) break;
        const board = parseBoard(text);
        // Decode imported images before replacing a working board.
        for (const item of board.items)
          if (item.kind === "image") {
            const img = new Image();
            img.src = item.src!;
            await img.decode();
            if (img.naturalWidth * img.naturalHeight > 80_000_000)
              throw new Error(`${item.name}: image exceeds 80 megapixels.`);
          }
        documentGeneration++;
        selected.clear();
        commit(board);
        exportedRevision = revision;
        fit();
        toast("Board opened");
        break;
      }
      case "new":
        if (history.board.items.length)
          $<HTMLDialogElement>("#confirm-dialog").showModal();
        else {
          documentGeneration++;
          selected.clear();
          commit(createBoard());
          fit();
        }
        break;
      case "cancel-new":
        $<HTMLDialogElement>("#confirm-dialog").close();
        break;
      case "confirm-new":
        documentGeneration++;
        selected.clear();
        commit(createBoard());
        fit();
        $<HTMLDialogElement>("#confirm-dialog").close();
        break;
      case "undo":
        preview = null;
        history.undo();
        selected.clear();
        render();
        persist();
        break;
      case "redo":
        preview = null;
        history.redo();
        selected.clear();
        render();
        persist();
        break;
      case "fit":
        fit();
        break;
      case "zoom-in":
      case "zoom-out":
        view = zoomAt(
          view,
          { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 },
          name === "zoom-in" ? 1.2 : 1 / 1.2,
        );
        renderView();
        break;
      case "reset-zoom":
        view = zoomAt(
          view,
          { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 },
          1 / view.zoom,
        );
        renderView();
        break;
      case "menu":
        $("#board-menu").hidden = !$("#board-menu").hidden;
        $('[data-action="menu"]').setAttribute(
          "aria-expanded",
          String(!$("#board-menu").hidden),
        );
        break;
      case "help":
        $<HTMLDialogElement>("#help-dialog").showModal();
        break;
      case "close-help":
        $<HTMLDialogElement>("#help-dialog").close();
        break;
      case "focus": {
        const previous = canvas.getBoundingClientRect();
        focusMode = !focusMode;
        $("#workspace").classList.toggle("focus-mode", focusMode);
        $("#exit-focus").hidden = !focusMode;
        const next = canvas.getBoundingClientRect();
        view.x += previous.left - next.left;
        view.y += previous.top - next.top;
        renderView();
        canvas.focus({ preventScroll: true });
        break;
      }
      case "move-window":
        windowMoveArmed = true;
        canvas.classList.add("move-window");
        toast("Drag anywhere to move the window. Escape cancels.");
        break;
      case "minimize":
        await minimizeWindow();
        break;
      case "close-window":
        await importQueue;
        await persistQueue;
        if (recoveredRevision < revision && exportedRevision < revision)
          $<HTMLDialogElement>("#close-dialog").showModal();
        else await closeWindow();
        break;
      case "cancel-close":
        $<HTMLDialogElement>("#close-dialog").close();
        break;
      case "discard-close":
        await closeWindow();
        break;
      case "save-close":
        await action("save");
        if (exportedRevision >= revision) await closeWindow();
        break;
      case "pin":
        await setAlwaysOnTop(!pinned);
        pinned = !pinned;
        $('[data-action="pin"]').setAttribute("aria-pressed", String(pinned));
        toast(pinned ? "Window stays on top" : "Always on top turned off");
        break;
      case "fullscreen":
        await setFullscreen(!fullscreen);
        fullscreen = !fullscreen;
        break;
      default:
        manipulate(name);
    }
  } catch (error) {
    toast(
      `Could not ${name === "open" ? "open board" : name === "save" ? "save board" : "complete action"}: ${(error as Error).message || String(error)}`,
    );
  }
}
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const control = target.closest<HTMLElement>("[data-action]");
  if (control) {
    void action(control.dataset.action!);
  } else if (!target.closest("#board-menu")) {
    $("#board-menu").hidden = true;
    $('[data-action="menu"]').setAttribute("aria-expanded", "false");
  }
});
document.addEventListener(
  "pointerdown",
  (e) => {
    if (!(e.target as HTMLElement).closest("#context-menu")) hideContextMenu();
  },
  { capture: true },
);
$("#context-menu").addEventListener("keydown", (e) => {
  if (e.key === " " && (e.target as HTMLElement).closest("button")) {
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat)
      (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.click();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End", "Escape", "Tab"].includes(e.key))
    return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === "Escape" || e.key === "Tab") {
    if (e.key === "Escape") cancelWindowMove();
    hideContextMenu(true);
    return;
  }
  const items = Array.from(
    $("#context-menu").querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ),
  );
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? items.length - 1
        : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length;
  items[next]?.focus();
});
$(".brand").addEventListener("click", (e) => {
  e.preventDefault();
  fit();
});
nameInput.addEventListener("change", () => {
  const name = nameInput.value.trim() || "Untitled board";
  if (name !== history.board.name) commit({ ...history.board, name });
  else nameInput.value = name;
});
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") nameInput.blur();
});
$<HTMLInputElement>("#image-input").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  void importImages(Array.from(input.files ?? []), importPoint ?? center());
  importPoint = null;
  input.value = "";
});
$("#note-form").addEventListener("submit", (e) => {
  if ((e as SubmitEvent).submitter?.getAttribute("value") !== "save") return;
  const text = $<HTMLTextAreaElement>("#note-text").value.trim();
  if (!text) {
    e.preventDefault();
    return;
  }
  if (noteId) {
    if (
      !changeItems((items) =>
        items.map((i) =>
          i.id === noteId
            ? {
                ...i,
                text,
                name: text.slice(0, 80),
                height: Math.max(i.height, noteHeight(text, i.width)),
              }
            : i,
        ),
      )
    )
      e.preventDefault();
  } else {
    if (history.board.items.length >= 2000) {
      e.preventDefault();
      toast("A board can contain up to 2,000 references.");
      return;
    }
    const p = notePoint ?? center();
    const id = crypto.randomUUID();
    selected = new Set([id]);
    const height = noteHeight(text, 280);
    if (
      !changeItems((items) => [
        ...items,
        {
          id,
          kind: "note",
          name: text.slice(0, 80),
          text,
          x: p.x - 140,
          y: p.y - height / 2,
          width: 280,
          height,
          rotation: 0,
          locked: false,
        },
      ])
    )
      e.preventDefault();
  }
});
canvas.addEventListener("dblclick", (e) => {
  const node = document
    .elementFromPoint(e.clientX, e.clientY)
    ?.closest<HTMLElement>(".board-item");
  const item = history.board.items.find((i) => i.id === node?.dataset.id);
  if (item?.kind === "note" && !item.locked) editNote(item);
});

type Gesture = {
  mode: "pan" | "move" | "resize" | "marquee";
  pointer: number;
  start: { x: number; y: number };
  view: View;
  board: Board;
  ids: Set<string>;
  item?: Item;
  moved: boolean;
};
let gesture: Gesture | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (ready && isDesktop && e.button === 0 && (e.altKey || windowMoveArmed)) {
    e.preventDefault();
    windowMoveArmed = false;
    canvas.classList.remove("move-window");
    void startWindowDrag().catch((error) =>
      toast(`Could not move window: ${String(error)}`),
    );
    return;
  }
  if (
    !ready ||
    gesture ||
    (e.button !== 0 && e.button !== 1) ||
    (e.target as HTMLElement).closest("button")
  )
    return;
  e.preventDefault();
  canvas.focus({ preventScroll: true });
  const point = localPoint(e);
  const node = (e.target as HTMLElement).closest<HTMLElement>(".board-item");
  const item = history.board.items.find((i) => i.id === node?.dataset.id);
  let mode: Gesture["mode"];
  if (spaceDown || e.button === 1) mode = "pan";
  else if (item) {
    if ((e.target as HTMLElement).closest(".resize-handle") && !item.locked)
      mode = "resize";
    else {
      if (e.shiftKey) {
        if (selected.has(item.id)) selected.delete(item.id);
        else selected.add(item.id);
      } else if (!selected.has(item.id)) selected = new Set([item.id]);
      mode = "move";
    }
    render();
  } else {
    if (!e.shiftKey) selected.clear();
    mode = "marquee";
    render();
  }
  gesture = {
    mode,
    pointer: e.pointerId,
    start: point,
    view: { ...view },
    board: history.board,
    ids: new Set(selected),
    item,
    moved: false,
  };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.toggle("panning", mode === "pan");
});
canvas.addEventListener("pointermove", (e) => {
  if (!gesture || gesture.pointer !== e.pointerId) return;
  const point = localPoint(e);
  const dx = point.x - gesture.start.x;
  const dy = point.y - gesture.start.y;
  if (Math.hypot(dx, dy) < 3 && !gesture.moved) return;
  gesture.moved = true;
  const g = gesture;
  if (g.mode === "pan") {
    view = { ...view, x: g.view.x + dx, y: g.view.y + dy };
    renderView();
  } else if (g.mode === "move") {
    preview = {
      ...g.board,
      items: g.board.items.map((i) =>
        g.ids.has(i.id) && !i.locked
          ? { ...i, x: i.x + dx / view.zoom, y: i.y + dy / view.zoom }
          : i,
      ),
    };
    render();
  } else if (g.mode === "resize" && g.item) {
    const i = g.item;
    const angle = (i.rotation * Math.PI) / 180;
    const localDx = (dx * Math.cos(angle) + dy * Math.sin(angle)) / view.zoom;
    const localDy = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / view.zoom;
    const scale = Math.max(
      24 / Math.min(i.width, i.height),
      Math.min(
        10000 / Math.max(i.width, i.height),
        1 +
          (localDx * i.width + localDy * i.height) /
            (i.width ** 2 + i.height ** 2),
      ),
    );
    const width = i.width * scale,
      height = i.height * scale;
    const dw = width - i.width,
      dh = height - i.height;
    preview = {
      ...g.board,
      items: g.board.items.map((it) =>
        it.id === i.id
          ? {
              ...it,
              width,
              height,
              x: i.x + (Math.cos(angle) * dw - Math.sin(angle) * dh - dw) / 2,
              y: i.y + (Math.sin(angle) * dw + Math.cos(angle) * dh - dh) / 2,
            }
          : it,
      ),
    };
    render();
  } else if (g.mode === "marquee") {
    const x = Math.min(point.x, g.start.x),
      y = Math.min(point.y, g.start.y),
      width = Math.abs(dx),
      height = Math.abs(dy);
    Object.assign($("#marquee").style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    $("#marquee").hidden = false;
    const p = worldPoint({ x, y });
    selected = new Set(g.ids);
    for (const item of g.board.items) {
      const b = bounds([item])!;
      if (
        b.x < p.x + width / view.zoom &&
        b.x + b.width > p.x &&
        b.y < p.y + height / view.zoom &&
        b.y + b.height > p.y
      )
        selected.add(item.id);
    }
    render();
  }
});
function finishGesture(cancel: boolean) {
  if (!gesture) return;
  const g = gesture;
  gesture = null;
  if (canvas.hasPointerCapture(g.pointer))
    canvas.releasePointerCapture(g.pointer);
  canvas.classList.remove("panning");
  $("#marquee").hidden = true;
  if (cancel) {
    preview = null;
    view = g.view;
    selected = g.ids;
    render();
  } else if (preview && g.moved) commit(preview);
  else {
    preview = null;
    render();
  }
}
canvas.addEventListener("pointerup", () => finishGesture(false));
canvas.addEventListener("pointercancel", () => finishGesture(true));
canvas.addEventListener("lostpointercapture", () => finishGesture(true));
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  showContextMenu({ x: e.clientX, y: e.clientY });
});
$(".topbar").addEventListener("pointerdown", (e) => {
  if (
    isDesktop &&
    e.button === 0 &&
    !(e.target as HTMLElement).closest("button,input,a")
  ) {
    void startWindowDrag().catch((error) =>
      toast(`Could not move window: ${String(error)}`),
    );
  }
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (gesture) return;
    view = zoomAt(
      view,
      localPoint(e),
      Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.002),
    );
    renderView();
  },
  { passive: false },
);
let dragDepth = 0;
canvas.addEventListener("dragenter", (e) => {
  e.preventDefault();
  if (e.dataTransfer?.types.includes("Files")) {
    dragDepth++;
    $("#drop-overlay").hidden = false;
  }
});
canvas.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});
canvas.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $("#drop-overlay").hidden = true;
  }
});
canvas.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("#drop-overlay").hidden = true;
  void importImages(
    Array.from(e.dataTransfer?.files ?? []),
    worldPoint(localPoint(e)),
  );
});
document.addEventListener("paste", (e) => {
  if (isEditing(e.target) || !ready) return;
  const files = Array.from(e.clipboardData?.files ?? []);
  if (files.length) {
    e.preventDefault();
    void importImages(files);
  }
});
document.addEventListener("keydown", (e) => {
  if (!ready || isEditing(e.target)) return;
  if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    showContextMenu(
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      true,
    );
    return;
  }
  const command = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  let requested: string | undefined;
  if (command) {
    if (key === "a") {
      e.preventDefault();
      selected = new Set(history.board.items.map((i) => i.id));
      render();
      return;
    }
    requested = (
      {
        s: "save",
        o: "open",
        n: "new",
        d: "duplicate",
        z: e.shiftKey ? "redo" : "undo",
        y: "redo",
        ...(isDesktop ? { q: "close-window" } : {}),
      } as Record<string, string>
    )[key];
  } else {
    if (key === " " && !e.repeat) {
      e.preventDefault();
      spaceDown = true;
      canvas.classList.add("space-pan");
      return;
    }
    if (key === "escape") {
      cancelWindowMove();
      hideContextMenu();
      finishGesture(true);
      selected.clear();
      $("#board-menu").hidden = true;
      $('[data-action="menu"]').setAttribute("aria-expanded", "false");
      render();
      return;
    }
    requested = (
      {
        i: "import",
        n: "note",
        f: "fit",
        "1": "reset-zoom",
        delete: "delete",
        backspace: "delete",
        "?": "help",
        f11: "fullscreen",
      } as Record<string, string>
    )[key];
    // Tab remains normal keyboard navigation while a control has focus.
    if (
      key === "tab" &&
      (e.target === canvas || e.target === document.body || focusMode)
    )
      requested = "focus";
  }
  if (requested) {
    e.preventDefault();
    if (!e.repeat) void action(requested);
  }
});
document.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    spaceDown = false;
    canvas.classList.remove("space-pan");
  }
});
window.addEventListener("blur", () => {
  spaceDown = false;
  canvas.classList.remove("space-pan");
  finishGesture(true);
  hideContextMenu();
  cancelWindowMove();
});
document.addEventListener("fullscreenchange", () => {
  if (!isDesktop) fullscreen = !!document.fullscreenElement;
});
window.addEventListener("resize", () => {
  hideContextMenu();
  renderView();
});
async function start() {
  render();
  try {
    const board = await loadRecovery();
    if (board) {
      history = new History(board);
      fit();
    }
    $("#save-status").textContent = "Saved on this device";
  } catch {
    $("#save-status").textContent = "Recovery unavailable";
    toast(
      "Could not restore the last session. You can still open a saved board.",
    );
  }
  ready = true;
  try {
    await installCloseHandler(() => {
      void action("close-window");
    });
  } catch (error) {
    toast(`Could not protect unsaved changes on close: ${String(error)}`);
  }
  render();
  canvas.focus({ preventScroll: true });
  document.documentElement.dataset.ready = "true";
}
void start();
