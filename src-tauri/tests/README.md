# Desktop verification

The desktop IPC suite uses Tauri's mock runtime and real temporary files. Only the dialog's chosen path is injected. It checks roundtrip saving, atomic replacement, cancellation, invalid and oversized input, UTF-8 errors, and filesystem failures:

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

The Windows desktop suite starts the actual application with `tauri-driver` and the Microsoft EdgeDriver matching the installed WebView2. It uses WebDriver HTTP directly, so no additional Node dependencies are required. It verifies the native WebView UI, image imports, undo/redo, actual window commands, Rust IPC rejection, and filesystem capability denial. It writes `test-results/desktop.png`.

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

The full browser end-to-end suite is `npm run test:e2e`. Native OS dialog interaction is a separate manual check until automated by the desktop suite: open/save/cancel, overwrite a file, and drop files from Explorer. Browser file chooser coverage and Rust IPC tests do not substitute for those OS interactions.

Documentation: [Tauri WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/), [Tauri dialogs](https://v2.tauri.app/plugin/dialog/).
