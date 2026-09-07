# Architecture

MindBoard is a Vite/TypeScript frontend inside a Tauri 2 desktop shell. The browser build uses the same interface and board model as the desktop application.

## Boundaries

| Module | Responsibility |
| --- | --- |
| `src/board.ts` | Portable data model, strict validation, history, geometry, viewport math, deterministic arrangement |
| `src/main.ts` | Accessible UI, input routing, pointer gestures, image decoding, selection and rendering |
| `src/storage.ts` | Transactional IndexedDB recovery with explicit success/failure reporting |
| `src/platform.ts` | Browser/native file and window adapter |
| `src-tauri/src/lib.rs` | Native dialogs, bounded reads, atomic writes, Tauri IPC |

The document contains only item data: stable IDs, geometry, rotation, locking, note text, and embedded raster data URLs. Viewport and selection are transient. Item array order is stacking order. History owns immutable snapshots and retains at most 100 entries. Image strings are shared between snapshots instead of being re-encoded.

The app starts with a borderless canvas and hidden controls. Its contextual menu dispatches the same actions as the optional toolbars and keyboard shortcuts. Switching controls compensates for the canvas's changed screen origin so references do not jump. Native move, minimize, and close live behind the platform adapter. Closing waits for queued imports and recovery, and offers save/cancel/discard if the latest document is not stored successfully.

A pointer gesture previews changes from one captured document. It commits once at pointer release, or rolls back on cancellation, lost capture, Escape, or loss of window focus. Other document actions finish a pending gesture first. Image imports run through a serial queue, and a document generation token discards imports that belong to a board replaced by New/Open.

Every document commit validates against the portable board schema. Recovery writes are serialized so an older write cannot overwrite a newer one. The UI reports successful persistence only after the IndexedDB transaction completes. Import and open failures preserve the current document.

## Desktop security

File paths are selected by native dialogs inside Rust; arbitrary frontend paths are never accepted by the board IPC commands. Writes use a temporary file in the destination directory followed by atomic replacement. Reads and writes enforce the board size limit. The frontend validates the full document schema and decodes images before replacing the current board.

Tauri capabilities allow the main window to use the required window controls. The application does not expose a general filesystem, shell, or network plugin. A restrictive Content Security Policy limits images to local assets, data URLs, and blobs, and permits only local IPC connections.

## Size and performance

There is no frontend framework, canvas library, server, or bundled browser runtime. Images use a transformed DOM layer with native image decoding. Pointer movement updates positions without serialization or storage writes. Serialization and persistence happen at document commit boundaries. Runtime memory depends primarily on decoded image content; a small executable does not imply a fixed memory footprint for large boards.
