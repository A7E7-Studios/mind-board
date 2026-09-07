// Drives the real packaged WebView2 frontend and Rust backend over WebDriver.
// No IPC mocks or test-only commands are shipped in the application.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
const driver = spawn(driverPath, ['--port', String(port), '--native-port', String(port + 1), '--native-driver', edgePath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile } });
let driverLog = '';
driver.stdout.on('data', chunk => { driverLog += chunk; });
driver.stderr.on('data', chunk => { driverLog += chunk; });
const endpoint = `http://127.0.0.1:${port}`;
let session;
let checks = 0;
async function request(method, path, data) {
  const response = await fetch(`${endpoint}${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body.value;
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
  const element = await request('POST', `/session/${session}/element`, { using: 'xpath', value: `//button[@aria-label=${JSON.stringify(label)} or normalize-space(text())=${JSON.stringify(label)}]` });
  const id = element['element-6066-11e4-a52e-4f735466cecf'];
  await request('POST', `/session/${session}/element/${id}/click`, {});
}
async function check(name, test) { await test(); checks++; console.log(`PASS ${name}`); }

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await request('GET', '/status'); break; } catch { await delay(100); }
  }
  const result = await request('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: binary } } } });
  session = result.sessionId;
  await request('POST', `/session/${session}/timeouts`, { implicit: 5000, script: 10000 });
  await waitFor('return document.documentElement.dataset.ready === "true"', 'application loads');
  await check('runs as a real Tauri desktop app', async () => {
    assert.equal(await execute('return !!window.__TAURI_INTERNALS__'), true);
    assert.match(await execute('return document.title'), /MindBoard/);
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
  console.log(`${checks} real desktop checks passed.`);
} catch (error) {
  console.error(driverLog);
  throw error;
} finally {
  if (session) await request('DELETE', `/session/${session}`).catch(() => {});
  driver.kill();
}
