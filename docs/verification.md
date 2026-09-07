# Verification record

Local validation of MindBoard 0.2.0 on 7 September 2026, Windows x64.

| Check | Result |
| --- | --- |
| TypeScript and Vite production build | Passed |
| Board model and persistence tests | 82 passed (73 model, 9 IndexedDB) |
| Playwright end-to-end tests, Microsoft Edge | 77 passed, including 18 note/paste scenarios and 5 image-quality checks |
| Rust IPC/filesystem tests | 7 passed |
| Packaged Windows app through WebDriver | 12 passed, including resize/zoom image detail, borderless startup, native window controls, failed-recovery close protection, and IPC permissions |
| Rust formatting | Passed |
| Clippy, all targets, warnings denied | Passed |
| Source formatting | Passed |
| Visual QA | Default minimal and optional full controls at 1280×820; responsive checks at 320/640 pixels |

Browser tests include real PNG/JPEG/WebP/GIF/AVIF decoding, exact-limit 20 MiB image recovery, combined-board 100 MiB rejection, interrupted pointer gestures, saved-file variants with reused IDs, inline note editing and formatting, long-note sizing, storage unavailability, file round trips, and all exposed browser controls. Real text clipboard paste is tested on the canvas and inside editors. Synthetic image clipboard and drop events preserve exact source bytes through resize/save/reload. Screenshot pixel contrast verifies sharp detail after shrinking images from 480 to 120 board pixels and ordinary wheel zoom back to source resolution, at 100% and 150% display scaling. Deliberately downsampled pixels provide a negative control. The optional Original pixels command also checks physical dimensions and alignment without changing the document. A private user-provided screenshot was checked locally through resize and ordinary wheel zoom at both display scales; it is not included in the repository or release. Headless Edge did not reproduce the old compositing hint's blur, so that specific cause remains an inference rather than a reproduced failure.

Production frontend: approximately 58 KB JavaScript and 16 KB CSS before compression, around 24 KB combined after gzip. These sizes exclude imported user images. The Windows x64 executable is 3,205,120 bytes (3.06 MiB). An NSIS installer and a portable ZIP with license notices were built and their contents verified. The native WebView2 screenshot retains alternating source pixels after resizing and ordinary wheel zoom; the deliberately downsampled control loses that detail. Native OS verification and exact coverage limits are recorded in [desktop verification](../src-tauri/tests/README.md).

The previous 0.1.0 build passed [clean Windows validation](https://github.com/A7E7-Studios/mind-board/actions/runs/34108858047), including native launch and restoration of the temporary app-specific CI debugging policy. Clean CI validation for 0.2.0 is required before publication. macOS/Linux desktop behavior remains unverified.
