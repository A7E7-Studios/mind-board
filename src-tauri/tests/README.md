# Desktop verification

The desktop IPC suite uses Tauri's mock runtime and real temporary files. Only the dialog's chosen path is injected. It checks roundtrip saving, atomic replacement, cancellation, invalid and oversized input, UTF-8 errors, and filesystem failures:

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

The Windows desktop suite starts the actual application with `tauri-driver` and the Microsoft EdgeDriver matching the installed WebView2. It uses WebDriver HTTP directly, so no additional Node dependencies are required. It creates a fresh isolated WebView2 profile per run, waits for recovery initialization, and checks eleven scenarios: the native WebView, borderless/minimal defaults, the Always on top menu with native state readback, notes with undo/redo, image file imports, fullscreen/topmost and filesystem capability enforcement, malformed-save rejection through real Rust IPC, context-menu minimize/restore, canceling an armed window move, protection from a native close request after recovery failure, and closing the actual application window. It writes `test-results/desktop.png` before closing the test window. Session creation allows 120 seconds for cold WebView2 startup; errors identify the WebDriver method and path.

Install the test driver locally (not globally):

```sh
cargo install tauri-driver --locked --root src-tauri/.tools
```

Download the matching `edgedriver_win64.zip` from [Microsoft Edge WebDriver](https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/) and extract `msedgedriver.exe` into `src-tauri/.tools/edge/`. The executable and ZIP are build tools, not application dependencies; do not commit them.

```sh
npm run desktop:build -- --no-bundle
node src-tauri/tests/desktop.e2e.mjs
```

Environment overrides: `MIND_BOARD_BINARY`, `TAURI_DRIVER`, `EDGE_DRIVER`, and `WEBDRIVER_PORT`. Use `MIND_BOARD_BINARY=src-tauri/target/debug/mind-board.exe` when testing a debug build.

The harness passes its isolated profile and optional `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` through `tauri:options.webviewOptions`, then removes inherited profile/runtime overrides from the driver environment. This keeps EdgeDriver's DevTools discovery and WebView2 on the same configuration. Microsoft documents these settings in [WebView2 driver capabilities](https://learn.microsoft.com/en-us/microsoft-edge/webdriver/capabilities-edge-options#webviewoptions-object). Startup diagnostics are written to `test-results/desktop-launch.json` and `test-results/desktop-driver.log`, including the selected runtime, requested/returned capabilities, driver identification, and whether the profile produced `DevToolsActivePort`.

The full browser end-to-end suite is `npm run test:e2e`. Native OS dialog interaction is checked separately using Windows computer-use automation; it is not part of the repeatable WebDriver script. Browser file chooser coverage and Rust IPC tests do not substitute for those OS interactions.

## Native verification record — 2026-09-07

Verified on Windows 11 with WebView2 / EdgeDriver 152.0.4191.66. Initial native file-dialog verification used the optimized `index-BTVEof0_.js` build; the subsequent borderless release uses `index-3LjeWjOv.js`:

- All seven Rust tests and `cargo clippy --all-targets -- -D warnings` passed.
- All six real desktop WebDriver checks passed.
- In a separate visible application with an isolated WebView2 profile, opened a board containing one note using the actual Windows Open dialog.
- Saved that nonempty board through Windows Save As, read the resulting file, and verified its name, item count, and note text.
- Reopened the saved file through Windows Open and verified the rendered title `Native dialog roundtrip`, note `Native OS dialogs work.`, and `1 reference` status.
- Canceled both native Open and Save As. The title, note, item count, and saved file SHA-256 remained unchanged.
- Saved over a disposable existing board using the actual Windows `Confirm Save As` prompt. Verified the prompt named the expected test file, confirmed replacement, and read the file to verify that the current board replaced its previous contents.
- Produced the Windows NSIS installer and included MIT and third-party license notices as installation resources.

The final borderless release passed all eleven desktop WebDriver checks. Native `is_decorated` reported false, optional bars started hidden, and Tab revealed the controls. Context-menu Minimize set the actual native minimized state and WebDriver successfully restored it. A native close request with simulated unavailable IndexedDB displayed the recovery guard, Cancel preserved the unsaved note and live window, restored recovery allowed a subsequent save, and the ordinary Close window action then terminated the application window. The native close handler uses Tauri's documented `onCloseRequested`/`preventDefault` behavior; its approved close path requires the SDK's internal window-destroy permission.

The Move window context action armed successfully and Escape in a reopened menu canceled it in the desktop suite. A Windows computer-use drag moved the pointer but did not produce an observed change in window position. Its documented `sky.drag` API provides from/to coordinates but no mouse-hold or duration control, so physical window movement remains unverified; the implementation uses Tauri's standard `startDragging()` call on the initial held-button pointer event.

Dragging directly from Explorer remains unverified: the computer-use provider returned `Computer Use app approval timed out` when inspecting the dedicated Explorer fixture window, before any drag could be attempted. This is an automation access limitation, not evidence of an application failure. DOM drop is covered by browser end-to-end tests; actual native file-input import is covered by the desktop suite. Installer creation was verified, but installation/uninstallation was not performed on this development machine.

Documentation: [Tauri WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/), [Tauri dialogs](https://v2.tauri.app/plugin/dialog/).
