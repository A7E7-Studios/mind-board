// Drives the real packaged WebView2 frontend and Rust backend over WebDriver.
// No IPC mocks or test-only commands are shipped in the application.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const binary = resolve(process.env.MIND_BOARD_BINARY ?? 'src-tauri/target/release/mind-board.exe');
const driverPath = resolve(process.env.TAURI_DRIVER ?? 'src-tauri/.tools/bin/tauri-driver.exe');
const edgePath = resolve(process.env.EDGE_DRIVER ?? 'src-tauri/.tools/edge/msedgedriver.exe');
for (const file of [binary, driverPath, edgePath]) {
  assert(existsSync(file), `Missing ${file}. See src-tauri/tests/README.md.`);
}
const port = Number(process.env.WEBDRIVER_PORT ?? 4444);
mkdirSync('src-tauri/.tools/profiles', { recursive: true });
const profile = mkdtempSync(resolve('src-tauri/.tools/profiles/desktop-'));
// Let EdgeDriver own the complete WebView2 configuration. An inherited profile
// override can send the app to a different directory than the driver watches
// for DevToolsActivePort, notably across different EdgeDriver versions.
const driverEnvironment = { ...process.env };
const runtimeFolder = driverEnvironment.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER;
delete driverEnvironment.WEBVIEW2_USER_DATA_FOLDER;
delete driverEnvironment.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER;
const capabilities = { alwaysMatch: { 'tauri:options': {
  application: binary,
  webviewOptions: { userDataFolder: profile, ...(runtimeFolder ? { browserExecutableFolder: runtimeFolder } : {}) },
} } };
const versionOf = file => {
  const result = spawnSync(file, ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
  return result.error?.message ?? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
};
const launchDiagnostics = { binary, profile, runtimeFolder: runtimeFolder ?? 'installed evergreen runtime', versions: { edgeDriver: versionOf(edgePath) }, tauriDriver: { path: driverPath, sha256: createHash('sha256').update(readFileSync(driverPath)).digest('hex') }, requestedCapabilities: capabilities };
mkdirSync('test-results', { recursive: true });
const driver = spawn(driverPath, ['--port', String(port), '--native-port', String(port + 1), '--native-driver', edgePath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: driverEnvironment });
let driverLog = '';
driver.stdout.on('data', chunk => { driverLog += chunk; });
driver.stderr.on('data', chunk => { driverLog += chunk; });
driver.on('error', error => { driverLog += `Driver process error: ${error.message}\n`; });
const endpoint = `http://127.0.0.1:${port}`;
let session;
let checks = 0;
async function request(method, path, data, timeout = 30_000) {
  try {
    const response = await fetch(`${endpoint}${path}`, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(timeout),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
    return body.value;
  } catch (error) {
    throw new Error(`WebDriver ${method} ${path} failed (timeout ${timeout}ms): ${error.message}`, { cause: error });
  }
}
const execute = (script, args = []) => request('POST', `/session/${session}/execute/sync`, { script, args });
async function waitFor(script, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await execute(script)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}
async function click(label) {
  const elements = await request('POST', `/session/${session}/elements`, { using: 'xpath', value: `//button[@aria-label=${JSON.stringify(label)} or normalize-space(text())=${JSON.stringify(label)}]` });
  for (const element of elements) {
    const id = element['element-6066-11e4-a52e-4f735466cecf'];
    if (await request('GET', `/session/${session}/element/${id}/displayed`)) {
      await request('POST', `/session/${session}/element/${id}/click`, {});
      return;
    }
  }
  throw new Error(`No visible button: ${label}`);
}
async function rightClickCanvas() {
  await request('POST', `/session/${session}/actions`, { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
    { type: 'pointerMove', duration: 0, x: 180, y: 180, origin: 'viewport' },
    { type: 'pointerDown', button: 2 }, { type: 'pointerUp', button: 2 },
  ] }] });
}
async function check(name, test) { await test(); checks++; console.log(`PASS ${name}`); }

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await request('GET', '/status'); break; } catch { await delay(100); }
  }
  console.log(`Starting native session: ${binary} (up to 120 seconds for cold WebView2 startup)`);
  const result = await request('POST', '/session', { capabilities }, 120_000);
  launchDiagnostics.returnedCapabilities = result.capabilities;
  session = result.sessionId;
  await request('POST', `/session/${session}/timeouts`, { implicit: 5000, script: 10000 });
  await waitFor('return document.documentElement.dataset.ready === "true"', 'application loads');
  await check('runs as a real Tauri desktop app', async () => {
    assert.equal(await execute('return !!window.__TAURI_INTERNALS__'), true);
    assert.match(await execute('return document.title'), /MindBoard/);
  });
  await check('starts as a borderless canvas with its optional controls hidden', async () => {
    assert.equal(await execute('return getComputedStyle(document.querySelector(".topbar")).visibility === "hidden" || getComputedStyle(document.querySelector(".topbar")).display === "none"'), true);
    assert.equal(await execute('return getComputedStyle(document.querySelector(".bottom-controls")).visibility === "hidden" || getComputedStyle(document.querySelector(".bottom-controls")).display === "none"'), true);
    const decorated = await request('POST', `/session/${session}/execute/async`, {
      script: `const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('plugin:window|is_decorated', { label: 'main' }).then(done, error => done(String(error)));`, args: [],
    });
    assert.equal(decorated, false);
    await execute('document.querySelector("#canvas").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true }))');
    await waitFor('return getComputedStyle(document.querySelector(".topbar")).visibility === "visible" && getComputedStyle(document.querySelector(".topbar")).display !== "none"', 'optional controls shown');
  });
  await check('Always on top menu toggles the actual native window state', async () => {
    for (const expected of [true, false]) {
      await click('Board menu');
      await click('Always on top');
      await waitFor(`return document.querySelector('[data-action="pin"]').getAttribute('aria-pressed') === '${expected}'`, 'pin menu state');
      const actual = await request('POST', `/session/${session}/execute/async`, {
        script: `const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('plugin:window|is_always_on_top', { label: 'main' }).then(done, error => done(String(error)));`, args: [],
      });
      assert.equal(actual, expected);
    }
  });
  await check('adds a note and undoes/redoes it through the native WebView', async () => {
    await click('Add note');
    await execute('const field = document.querySelector("#note-dialog textarea"); field.value = "Native desktop reference"; field.dispatchEvent(new Event("input", { bubbles: true }));');
    await execute('document.querySelector("#note-submit").click()');
    await waitFor('return document.querySelectorAll(".board-item").length === 1', 'note created');
    assert.match(await execute('return document.querySelector(".board-item").textContent'), /Native desktop reference/);
    await click('Undo');
    await waitFor('return document.querySelectorAll(".board-item").length === 0', 'undo');
    await click('Redo');
    await waitFor('return document.querySelectorAll(".board-item").length === 1', 'redo');
  });
  await check('imports a real image file through the native WebView', async () => {
    mkdirSync('src-tauri/.tools/fixtures', { recursive: true });
    const fixture = resolve('src-tauri/.tools/fixtures/reference.png');
    writeFileSync(fixture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
    const input = await request('POST', `/session/${session}/element`, { using: 'css selector', value: '#image-input' });
    await request('POST', `/session/${session}/element/${input['element-6066-11e4-a52e-4f735466cecf']}/value`, { text: fixture });
    await waitFor('return document.querySelectorAll(".board-item img").length === 1', 'image imported');
    assert.equal(await execute('return document.querySelector(".board-item img").naturalWidth > 0'), true);
    await click('Fit all');
  });
  await check('native window permissions work and arbitrary filesystem access is denied', async () => {
    const response = await request('POST', `/session/${session}/execute/async`, {
      script: `const done = arguments[arguments.length - 1]; (async () => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        for (const value of [true, false]) {
          await invoke('plugin:window|set_always_on_top', { label: 'main', value });
          if (await invoke('plugin:window|is_always_on_top', { label: 'main' }) !== value) throw new Error('Native topmost state mismatch');
        }
        for (const value of [true, false]) {
          await invoke('plugin:window|set_fullscreen', { label: 'main', value });
          if (await invoke('plugin:window|is_fullscreen', { label: 'main' }) !== value) throw new Error('Native fullscreen state mismatch');
        }
        try { await invoke('plugin:fs|read_text_file', { path: 'C:\\Windows\\win.ini' }); return { denied: false }; }
        catch (error) { return { denied: true, error: String(error) }; }
      })().then(done, error => done({ failure: String(error) }));`, args: [],
    });
    assert.equal(response.failure, undefined, response.failure);
    assert.equal(response.denied, true);
    assert.match(response.error, /not allowed|denied/i);
  });
  await check('invalid save fails through actual Rust IPC before opening a dialog', async () => {
    const result = await request('POST', `/session/${session}/execute/async`, {
      script: `const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('save_board_file', { contents: 'broken json', suggestedName: 'Invalid' }).then(() => done('unexpected success'), error => done(String(error)));`, args: [],
    });
    assert.match(result, /not valid JSON/);
  });
  mkdirSync('test-results', { recursive: true });
  const screenshot = await request('GET', `/session/${session}/screenshot`);
  writeFileSync('test-results/desktop.png', Buffer.from(screenshot, 'base64'));
  await check('context menu minimizes the actual native window and it can be restored', async () => {
    await rightClickCanvas();
    await click('Minimize');
    const minimized = await request('POST', `/session/${session}/execute/async`, {
      script: `const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('plugin:window|is_minimized', { label: 'main' }).then(done, error => done(String(error)));`, args: [],
    });
    assert.equal(minimized, true);
    await request('POST', `/session/${session}/window/maximize`, {});
    const restored = await request('POST', `/session/${session}/execute/async`, {
      script: `const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('plugin:window|is_minimized', { label: 'main' }).then(done, error => done(String(error)));`, args: [],
    });
    assert.equal(restored, false);
  });
  await check('Escape in a reopened context menu cancels the armed window move', async () => {
    await rightClickCanvas();
    await click('Move window');
    await waitFor('return document.querySelector("#canvas").classList.contains("move-window")', 'window move armed');
    await rightClickCanvas();
    await request('POST', `/session/${session}/actions`, { actions: [{ type: 'key', id: 'keyboard', actions: [
      { type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' },
    ] }] });
    await waitFor('return !document.querySelector("#canvas").classList.contains("move-window") && document.querySelector("#context-menu").hidden', 'window move canceled');
  });
  await check('native close request protects changes when recovery fails', async () => {
    await execute(`window.__originalIndexedDBOpen = indexedDB.open;
      indexedDB.open = function() {
        const request = { error: new DOMException('Simulated unavailable recovery', 'UnknownError') };
        setTimeout(() => request.onerror?.(new Event('error')), 0);
        return request;
      };`);
    await click('Add note');
    await execute('document.querySelector("#note-text").value = "Unsaved native close protection"; document.querySelector("#note-submit").click()');
    await waitFor('return document.querySelector("#save-status").textContent.includes("Recovery unavailable")', 'failed recovery reported');
    await request('POST', `/session/${session}/execute/async`, {
      script: `const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }).then(() => done(true), error => done(String(error)));`, args: [],
    });
    await waitFor('return document.querySelector("#close-dialog").open', 'native close intercepted by recovery guard');
    await execute('document.querySelector("[data-action=cancel-close]").click()');
    await waitFor('return !document.querySelector("#close-dialog").open', 'guard canceled');
    assert.match(await execute('return document.querySelector("#world").textContent'), /Unsaved native close protection/);
    assert.equal((await request('GET', `/session/${session}/window/handles`)).length, 1);
    await execute('indexedDB.open = window.__originalIndexedDBOpen; delete window.__originalIndexedDBOpen');
    await click('Add note');
    await execute('document.querySelector("#note-text").value = "Recovery restored before close"; document.querySelector("#note-submit").click()');
    await waitFor('return document.querySelector("#save-status").textContent === "Saved on this device"', 'latest changes recovered');
  });
  await check('context menu closes its own native application window', async () => {
    await rightClickCanvas();
    await click('Close window').catch(error => {
      if (!/no such window|invalid session id|web view not found|disconnected/i.test(error.message)) throw error;
    });
    let closed = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { closed = (await request('GET', `/session/${session}/window/handles`)).length === 0; }
      catch (error) {
        if (!/no such window|invalid session id|web view not found|disconnected/i.test(error.message)) throw error;
        closed = true;
      }
      if (closed) break;
      await delay(100);
    }
    assert.equal(closed, true);
  });
  console.log(`${checks} real desktop checks passed.`);
} catch (error) {
  launchDiagnostics.failure = error.stack;
  console.error(driverLog);
  throw error;
} finally {
  launchDiagnostics.profileEntries = existsSync(profile) ? readdirSync(profile) : [];
  launchDiagnostics.devToolsActivePortExists = existsSync(resolve(profile, 'EBWebView/DevToolsActivePort'));
  writeFileSync('test-results/desktop-launch.json', JSON.stringify(launchDiagnostics, null, 2));
  writeFileSync('test-results/desktop-driver.log', driverLog);
  if (session) await request('DELETE', `/session/${session}`).catch(() => {});
  driver.kill();
}
