# Verification record

Local validation on 7 September 2026, Windows x64.

| Check | Result |
| --- | --- |
| TypeScript and Vite production build | Passed |
| Board model and persistence tests | 61 passed (52 model, 9 IndexedDB) |
| Playwright end-to-end tests, Microsoft Edge | 51 passed, including 11 minimal/context-menu scenarios |
| Rust IPC/filesystem tests | 7 passed |
| Packaged Windows app through WebDriver | 11 passed, including borderless startup, native window controls, failed-recovery close protection, and IPC permissions |
| Rust formatting | Passed |
| Clippy, all targets, warnings denied | Passed |
| Source formatting | Passed |
| Visual QA | Default minimal and optional full controls at 1280×820; responsive checks at 320/640 pixels |

Browser tests include real PNG/JPEG/WebP/GIF/AVIF decoding, exact-limit 20 MiB image recovery, combined-board 100 MiB rejection, interrupted pointer gestures, saved-file variants with reused IDs, long-note sizing, storage unavailability, file round trips, and all exposed browser controls. Synthetic clipboard and drop events exercise browser handlers with actual image bytes.

Production frontend: approximately 50 KB JavaScript and 14 KB CSS before compression, around 20 KB combined after gzip. These sizes exclude imported user images. The final Windows x64 executable is 3,202,560 bytes (3.05 MiB). An NSIS installer and a portable ZIP with license notices were built. Native OS verification and exact coverage limits are recorded in [desktop verification](../src-tauri/tests/README.md).

The workflow is checked in for future runs. Local results do not imply that remote GitHub Actions have run or that macOS/Linux desktop behavior has been verified.
