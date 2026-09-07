# Verification record

Local validation of MindBoard 0.2.2 on 7 September 2026, Windows x64.

| Check | Result |
| --- | --- |
| TypeScript and Vite production build | Passed |
| Board model and persistence tests | 82 passed (73 model, 9 IndexedDB) |
| Playwright end-to-end tests, Microsoft Edge | 88 passed, including 9 clipboard, 20 note/paste, and 5 image-quality scenarios |
| Rust IPC/filesystem tests | 7 passed |
| Packaged Windows app through WebDriver | 14 passed, including cross-process image clipboard, empty colored notes, full-height note editing, resize/zoom image detail, borderless startup, native window controls, failed-recovery close protection, and IPC permissions |
| Rust formatting | Passed |
| Clippy, all targets, warnings denied | Passed |
| Source formatting | Passed |
| Visual QA | Default minimal and optional full controls at 1280×820; responsive checks at 320/640 pixels; tall multiline note at 1280×900 |

The 0.2.1 note regressions reproduced both reported bugs before the fix: empty notes were discarded on Done or outside click, and a 600-pixel note's editor was capped at 450 pixels in a 900-pixel viewport. They now verify empty colored-note export/recovery and undo/redo, Escape cancellation, and full-height multiline editing without premature scrolling. The packaged Windows app also confirms empty-note persistence and an editor height of 997 pixels matching both the note and its scroll height, with no maximum-height restriction.

The 0.2.2 clipboard tests cover all five image formats, full source dimensions and transparency after board resizing, copy from locked/rotated references, unchanged document/history, ordinary text copying in editors, denied writes, and unsupported selections. A large accepted JPEG produces a standard clipboard PNG above 20 MiB; real paste back into MindBoard retains its original compressed source and native dimensions. Malformed, unrelated, and remote clipboard HTML falls back without rendering HTML or fetching URLs. An independent Windows Forms process reads the native app's clipboard as a 1920×512 bitmap with exact fixture pixels, followed by actual Ctrl+V back into MindBoard. Its in-memory clipboard backup was restored successfully; previous user clipboard contents are not written to diagnostic logs.

Browser tests include real PNG/JPEG/WebP/GIF/AVIF decoding, exact-limit 20 MiB image recovery, combined-board 100 MiB rejection, interrupted pointer gestures, saved-file variants with reused IDs, inline note editing and formatting, long-note sizing, storage unavailability, file round trips, and all exposed browser controls. Real text clipboard paste is tested on the canvas and inside editors. Synthetic image clipboard and drop events preserve exact source bytes through resize/save/reload. Screenshot pixel contrast verifies sharp detail after shrinking images from 480 to 120 board pixels and ordinary wheel zoom back to source resolution, at 100% and 150% display scaling. Deliberately downsampled pixels provide a negative control. The optional Original pixels command also checks physical dimensions and alignment without changing the document. A private user-provided screenshot was checked locally through resize and ordinary wheel zoom at both display scales; it is not included in the repository or release. Headless Edge did not reproduce the old compositing hint's blur, so that specific cause remains an inference rather than a reproduced failure.

Production frontend: approximately 60 KB JavaScript and 16 KB CSS before compression, around 24 KB combined after gzip. These sizes exclude imported user images. The Windows x64 executable is 3,205,632 bytes (3.06 MiB). An NSIS installer and a portable ZIP with license notices were built and their contents verified. The native WebView2 screenshot retains alternating source pixels after resizing and ordinary wheel zoom; the deliberately downsampled control loses that detail. Native OS verification and exact coverage limits are recorded in [desktop verification](../src-tauri/tests/README.md).

Version 0.2.2 at commit `d6a4b77` passed all 191 automated checks in [clean Windows validation](https://github.com/A7E7-Studios/mind-board/actions/runs/34125671794), including the independent Windows clipboard round trip. macOS/Linux desktop behavior remains unverified.
