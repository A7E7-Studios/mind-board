# Testing and release checks

The test layers are deliberately separate. Browser automation verifies the production frontend behavior. Rust tests verify native IPC and real filesystem operations with only the file-picker decision substituted. Tauri WebDriver verifies the built Windows executable and its real native window APIs. Native file dialogs also require actual OS interaction; see the native test notes for verification evidence.

## Feature matrix

| Functionality | Verification |
| --- | --- |
| Empty state and image picker | Playwright actual file input and native WebView file upload |
| PNG/JPEG/WebP/GIF image decoding | Playwright real decodable fixtures |
| AVIF | Supported by the webview; dedicated fixture decoding test |
| Drop and clipboard import | Playwright DOM drag/clipboard events with real image bytes |
| Pan, anchored zoom, fit, reset | Pure transform tests plus pointer/wheel/button E2E |
| Selection, Shift-select, marquee, select all | Playwright pointer and keyboard interactions |
| Move and proportional resize | Playwright geometry assertions, one-step undo, gesture cancellation |
| Rotation and arrangement | Rotation-aware model tests and visible geometry E2E |
| Duplicate, delete, stacking and locking | Playwright commands, visible state, and undo |
| Notes and text editing | Playwright creation, double-click editing, input shortcut isolation |
| Rename, portable save/open | Download and reopen the actual file; image data and title asserted |
| Invalid files and size bounds | Model parser tests, browser rejection tests, Rust bounded I/O tests |
| Undo/redo branching and snapshot isolation | Unit tests plus interaction regressions |
| Recovery and storage failure | IndexedDB unit tests and reload E2E |
| Help, focus, fullscreen and shortcuts | Playwright interface tests |
| Always-on-top and native fullscreen | Real Tauri WebDriver commands with native state assertions |
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
