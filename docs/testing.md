# Testing and release checks

The test layers are deliberately separate. Browser automation verifies the production frontend behavior. Rust tests verify native IPC and real filesystem operations with only the file-picker decision substituted. Tauri WebDriver verifies the built Windows executable and its real native window APIs. Native file dialogs also require actual OS interaction; see the native test notes for verification evidence.

## Feature matrix

| Functionality | Verification |
| --- | --- |
| Empty state and image picker | Playwright actual file input and native WebView file upload |
| PNG/JPEG/WebP/GIF image decoding | Playwright real decodable fixtures |
| AVIF | Supported by the webview; dedicated fixture decoding test |
| Drop and clipboard import | Playwright DOM drag/clipboard events with real image bytes |
| Image copy and paste | Real system clipboard PNG read by an independent consumer, original dimensions/transparency after resize, original compressed source on same-app paste, editor text-copy isolation, and clipboard failure feedback |
| Note copy and paste | Real clipboard text in an independent consumer; styled and empty note round trips retain text, color, typography, geometry, and rotation; new unlocked IDs, undo/redo/recovery, editor text paste, and malformed metadata fallback |
| Pan, anchored zoom, fit, reset | Pure transform tests plus pointer/wheel/button E2E |
| Selection, Shift-select, marquee, select all | Playwright pointer and keyboard interactions |
| Move and proportional resize | Playwright geometry assertions, one-step undo, gesture cancellation |
| Rotation and arrangement | Rotation-aware model tests and visible geometry E2E |
| Duplicate, delete, stacking and locking | Playwright commands, visible state, and undo |
| Notes and text editing | Inline draft creation, double-click/type editing, commit/cancel, empty colored cards, formatting round trips, adjacent notes, full-height multiline editing, input shortcut isolation, and async import preservation |
| Text paste | Canvas note creation, multiline and HTML-fallback handling, source limits, image precedence, real clipboard paste inside editors |
| Image fidelity | Exact image bytes through drop/paste/resize/save/reload; screenshot pixel contrast after shrinking and ordinary wheel zoom at 100% and 150% display scaling, plus a deliberately blurred negative control |
| Original pixels view | Double-click and context menu, physical dimensions and alignment at 100% and 150% display scaling, unchanged document and undo history |
| Rename, portable save/open | Download and reopen the actual file; image data and title asserted |
| Invalid files and size bounds | Model parser tests, browser rejection tests, Rust bounded I/O tests |
| Undo/redo branching and snapshot isolation | Unit tests plus interaction regressions |
| Recovery and storage failure | IndexedDB unit tests and reload E2E |
| Help, focus, fullscreen and shortcuts | Playwright interface tests |
| Default minimal canvas and right-click tools | Contextual action round trips, keyboard navigation/Space, viewport clamping, optional bars and native undecorated state |
| Always-on-top and native fullscreen | Real Tauri WebDriver commands with native state assertions |
| Native minimize and close | Real window-state checks; failed recovery blocks close until save/discard/cancel; system close request exercises the same guard |
| Native save/open | Rust IPC/file round trips and actual Windows dialog checks |
| Capability restrictions | Real desktop IPC rejection of arbitrary filesystem access |
| Responsive UI and runtime errors | Narrow-window smoke tests; every browser test checks uncaught errors |

## Commands

```sh
npm run build
npm test
npm run test:e2e
npm run test:native
npm run desktop:build -- --no-bundle
npm run test:desktop
```

Playwright creates a browsable HTML report in `playwright-report/` and retains traces/screenshots on failure. Native WebDriver writes a screenshot to `test-results/desktop.png`. The CI workflow runs the browser suite and Rust checks on Windows and builds the actual desktop executable.

Tests exercise externally visible behavior and the real board schema. There are no test-only document mutation APIs in the shipped application. Browser-generated drop/paste events verify event handling and image decoding but cannot establish OS clipboard or desktop file-drag behavior by themselves. Native dialog checks complement, rather than replace, the repeatable IPC tests.

No cross-platform native results or large-board memory benchmarks are implied by Windows checks. Release validation should be repeated on each supported operating system and on any target WebView upgrade.
