# Desktop verification

The desktop IPC suite uses Tauri's mock runtime and real temporary files. Only the dialog's chosen path is injected. It checks roundtrip saving, atomic replacement, cancellation, invalid and oversized input, UTF-8 errors, and filesystem failures:

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

The Windows desktop suite starts the actual application with Microsoft EdgeDriver matching the installed WebView2. It uses WebDriver HTTP directly, so no additional Node dependencies are required. It creates a fresh isolated WebView2 profile per run, waits for recovery initialization, and checks twelve scenarios: the native WebView, borderless/minimal defaults, the Always on top menu with native state readback, notes with undo/redo, image file imports, source-pixel detail after resize and wheel zoom, fullscreen/topmost and filesystem capability enforcement, malformed-save rejection through real Rust IPC, context-menu minimize/restore, canceling an armed window move, protection from a native close request after recovery failure, and closing the actual application window. It writes `test-results/desktop.png` before closing the test window. Session creation allows 120 seconds for cold WebView2 startup; errors identify the WebDriver method and path.

Version 0.2.1 adds a thirteenth scenario for empty colored notes and full-height multiline editing. The final `index-DR0Yp1sy.js` build passes all thirteen locally: an empty sage note survives Done, Undo, and Redo, and the tall editor's height, note height, and scroll height all measure 997 pixels without the old half-viewport cap.

The optional `DESKTOP_DRIVER=tauri` mode uses a workspace-local Tauri driver:

```sh
cargo install tauri-driver --locked --root src-tauri/.tools
```

Download the matching `edgedriver_win64.zip` from [Microsoft Edge WebDriver](https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/) and extract `msedgedriver.exe` into `src-tauri/.tools/edge/`. The executable and ZIP are build tools, not application dependencies; do not commit them.

```sh
npm run desktop:build -- --no-bundle
node src-tauri/tests/desktop.e2e.mjs
```

Environment overrides: `MIND_BOARD_BINARY`, `DESKTOP_DRIVER` (`edge`, the default, or `tauri`), `TAURI_DRIVER`, `EDGE_DRIVER`, and `WEBDRIVER_PORT`. Use `MIND_BOARD_BINARY=src-tauri/target/debug/mind-board.exe` when testing a debug build.

The harness passes its isolated profile and optional `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` through `ms:edgeOptions.webviewOptions` (or `tauri:options.webviewOptions` in Tauri driver mode), then removes inherited profile/runtime overrides from the driver environment. This keeps EdgeDriver's DevTools discovery and WebView2 on the same configuration. Microsoft documents these settings in [WebView2 driver capabilities](https://learn.microsoft.com/en-us/microsoft-edge/webdriver/capabilities-edge-options#webviewoptions-object). Startup diagnostics are written to `test-results/desktop-launch.json` and `test-results/desktop-driver.log`, including the selected runtime, requested/returned capabilities, driver identification, and whether the profile produced `DevToolsActivePort`. Direct mode also records verbose `test-results/edgedriver.log` and requests `test-results/webview2.log`.

The disposable GitHub Actions runner explicitly opts into `DESKTOP_ELEVATED_POLICY=1` because recent WebView2 versions restrict debugging arguments for elevated applications; see [Microsoft's WebView2 issue](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645). This option requires `GITHUB_ACTIONS=true`, the exact binary name `mind-board.exe`, and an explicit runtime folder. The helper backs up and temporarily sets only the `mind-board.exe` and `com.a7e7.mindboard` named values under the HKLM WebView2 `AdditionalBrowserArguments`, `UserDataFolder`, and `BrowserExecutableFolder` policies. It enables a dynamically selected debugging port and logging for the isolated test profile. The harness restores prior values in `finally`, including after partial setup or failed session creation. This option remains off for local tests; registry execution is reserved for the disposable runner.

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

Version 0.2.0 (`index-BJoul1Lu.js`) passed twelve native scenarios, with the note flows migrated to inline editing and the Done editing note control. The additional image fidelity scenario imports a 1920 × 512 PNG with alternating two-source-pixel black/white stripes through the native file input, shrinks its placement from 480px to 120px using WebDriver pointer actions, and applies ordinary wheel zoom until its physical width is 1920px. The actual WebView screenshot retained 50% dark and 50% light pixels with adjacent contrast 127.12/255 at DPR 1 and physical left coordinate −498.884765625px. The deliberately downsampled negative control returned zero dark/light fractions and zero contrast. Two-pixel stripes preserve dark/light interiors regardless of fractional placement phase, unlike single-pixel stripes that can blend on the CI runner. The check requires more than 20% dark and 20% light pixels and adjacent contrast above 110; a quarter-resolution placement raster averages each full stripe period to gray. These assertions detect loss of source detail; this is not a claim of exact screenshot/source pixel equality. Evidence is saved in `test-results/desktop-image-detail.png` and `desktop-launch.json`. Rust formatting, strict Clippy, and all seven Rust tests passed again. The optimized Windows NSIS installer and portable ZIP were generated with matching 0.2.0 metadata, license notices, and SHA-256 checksums. The OS dialog verification above predates this UI revision; its native dialog implementation is unchanged.

The Move window context action armed successfully and Escape in a reopened menu canceled it in the desktop suite. A Windows computer-use drag moved the pointer but did not produce an observed change in window position. Its documented `sky.drag` API provides from/to coordinates but no mouse-hold or duration control, so physical window movement remains unverified; the implementation uses Tauri's standard `startDragging()` call on the initial held-button pointer event.

Dragging directly from Explorer remains unverified: the computer-use provider returned `Computer Use app approval timed out` when inspecting the dedicated Explorer fixture window, before any drag could be attempted. This is an automation access limitation, not evidence of an application failure. DOM drop is covered by browser end-to-end tests; actual native file-input import is covered by the desktop suite. Installer creation was verified, but installation/uninstallation was not performed on this development machine.

Documentation: [Tauri WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/), [Tauri dialogs](https://v2.tauri.app/plugin/dialog/).
