// Drives the real packaged WebView2 frontend and Rust backend over WebDriver.
// No IPC mocks or test-only commands are shipped in the application.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createInterface } from 'node:readline';

const binary = resolve(process.env.MIND_BOARD_BINARY ?? 'src-tauri/target/release/mind-board.exe');
const driverPath = resolve(process.env.TAURI_DRIVER ?? 'src-tauri/.tools/bin/tauri-driver.exe');
const edgePath = resolve(process.env.EDGE_DRIVER ?? 'src-tauri/.tools/edge/msedgedriver.exe');
const driverKind = process.env.DESKTOP_DRIVER ?? 'edge';
assert(['edge', 'tauri'].includes(driverKind), 'DESKTOP_DRIVER must be edge or tauri');
const elevatedPolicy = process.env.DESKTOP_ELEVATED_POLICY === '1';
if (elevatedPolicy) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Elevated policy is restricted to disposable GitHub Actions runners');
  assert.equal(basename(binary).toLowerCase(), 'mind-board.exe', 'Elevated policy is scoped to mind-board.exe only');
}
for (const file of [binary, edgePath, ...(driverKind === 'tauri' ? [driverPath] : [])]) {
  assert(existsSync(file), `Missing ${file}. See src-tauri/tests/README.md.`);
}
const port = Number(process.env.WEBDRIVER_PORT ?? 4444);
mkdirSync('src-tauri/.tools/profiles', { recursive: true });
const profile = mkdtempSync(resolve('src-tauri/.tools/profiles/desktop-'));
// Let EdgeDriver own the complete WebView2 configuration. An inherited profile
// override can send the app to a different directory than the driver watches
// for DevToolsActivePort, notably across different EdgeDriver versions.
const driverEnvironment = { ...process.env };
driverEnvironment.TAURI_AUTOMATION = 'true';
driverEnvironment.TAURI_WEBVIEW_AUTOMATION = 'true';
const runtimeFolder = driverEnvironment.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER;
if (elevatedPolicy) assert(runtimeFolder, 'Elevated CI policy requires an explicit WebView2 runtime folder');
delete driverEnvironment.WEBVIEW2_USER_DATA_FOLDER;
delete driverEnvironment.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER;
const webviewOptions = {
  userDataFolder: profile,
  ...(runtimeFolder ? { browserExecutableFolder: runtimeFolder } : {}),
  additionalBrowserArguments: ['--enable-logging', `--log-file=${resolve('test-results/webview2.log')}`],
};
const capabilities = { alwaysMatch: driverKind === 'edge' ? {
  browserName: 'webview2', 'ms:edgeChromium': true,
  'ms:edgeOptions': { binary, args: [], webviewOptions },
} : { 'tauri:options': { application: binary, webviewOptions } } };
const versionOf = file => {
  const result = spawnSync(file, ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
  return result.error?.message ?? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
};
const selectedDriver = driverKind === 'edge' ? edgePath : driverPath;
const launchDiagnostics = { binary, profile, driverKind, elevatedPolicy, runtimeFolder: runtimeFolder ?? 'installed evergreen runtime', inheritedAdditionalBrowserArguments: driverEnvironment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? null, versions: { edgeDriver: versionOf(edgePath) }, driver: { path: selectedDriver, sha256: createHash('sha256').update(readFileSync(selectedDriver)).digest('hex') }, requestedCapabilities: capabilities };
mkdirSync('test-results', { recursive: true });
const driverArguments = driverKind === 'edge'
  ? [`--port=${port}`, '--verbose', `--log-path=${resolve('test-results/edgedriver.log')}`]
  : ['--port', String(port), '--native-port', String(port + 1), '--native-driver', edgePath];
let driver;
let clipboardProbe;
let driverLog = '';
const policyState = resolve('src-tauri/.tools/policy-backups', `${basename(profile)}.json`);
function policy(mode) {
  const result = spawnSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('src-tauri/tests/elevated-policy.ps1'), '-Mode', mode, '-StatePath', policyState,
    ...(mode === 'Apply' ? ['-ProfilePath', profile, '-RuntimePath', runtimeFolder, '-BrowserLogPath', resolve('test-results/webview2.log')] : [])],
  { windowsHide: true, encoding: 'utf8', timeout: 15_000 });
  driverLog += `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error || result.status !== 0) throw new Error(`WebView2 policy ${mode} failed: ${result.error?.message ?? result.stderr}`);
}
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
async function writeNote(text) {
  await waitFor('return !!document.querySelector(".note-editor")', 'inline note editor opened');
  await execute('const field = document.querySelector(".note-editor"); field.value = arguments[0]; field.dispatchEvent(new Event("input", { bubbles: true }));', [text]);
  await click('Done editing note');
  await waitFor('return !document.querySelector(".note-editor")', 'inline note committed');
}
async function check(name, test) { await test(); checks++; console.log(`PASS ${name}`); }
async function startClipboardProbe() {
  const startedAt = Date.now();
  const diagnostics = { stages: [] };
  launchDiagnostics.clipboardProbe = diagnostics;
  const child = spawn('pwsh.exe', ['-NoProfile', '-NonInteractive', '-STA', '-File', resolve('src-tauri/tests/clipboard-probe.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let errors = '';
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-8000); });
  createInterface({ input: child.stderr }).on('line', line => {
    if (line.startsWith('clipboard-probe:') && diagnostics.stages.length < 32) {
      diagnostics.stages.push({ stage: line.slice('clipboard-probe:'.length), elapsedMs: Date.now() - startedAt });
    }
  });
  child.on('error', error => { diagnostics.processError = error.code ?? error.name; });
  child.on('exit', (code, signal) => { diagnostics.exit = { code, signal }; });
  const command = async (value, timeoutMs = 10_000) => {
    if (value) child.stdin.write(`${value}\n`);
    let timeout;
    try {
      const line = await Promise.race([lines.next(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Windows clipboard probe ${value ?? 'startup'} timed out after ${timeoutMs}ms; last stage: ${diagnostics.stages.at(-1)?.stage ?? 'process launch'}`)), timeoutMs); })]);
      if (line.done) throw new Error(`Windows clipboard probe exited: ${errors}`);
      return JSON.parse(line.value);
    } finally { clearTimeout(timeout); }
  };
  clipboardProbe = { child, command };
  // A clean Windows runner needs time for PowerShell/.NET assembly loading,
  // first-use interop compilation, and materializing the clipboard backup.
  const ready = await command(undefined, 60_000);
  diagnostics.startupMs = Date.now() - startedAt;
  assert.equal(ready.ready, true);
  launchDiagnostics.clipboardBackup = ready;
  return clipboardProbe;
}

try {
  if (elevatedPolicy) {
    mkdirSync(resolve('src-tauri/.tools/policy-backups'), { recursive: true });
    policy('Apply');
  }
  driver = spawn(selectedDriver, driverArguments, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: driverEnvironment });
  driver.stdout.on('data', chunk => { driverLog += chunk; });
  driver.stderr.on('data', chunk => { driverLog += chunk; });
  driver.on('error', error => { driverLog += `Driver process error: ${error.message}\n`; });
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
    launchDiagnostics.clipboardApi = await execute('return { secureContext: isSecureContext, clipboardWrite: typeof navigator.clipboard?.write, clipboardItem: typeof ClipboardItem }');
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
    await writeNote('Native desktop reference');
    await waitFor('return document.querySelectorAll(".board-item").length === 1', 'note created');
    assert.match(await execute('return document.querySelector(".board-item").textContent'), /Native desktop reference/);
    await click('Undo');
    await waitFor('return document.querySelectorAll(".board-item").length === 0', 'undo');
    await click('Redo');
    await waitFor('return document.querySelectorAll(".board-item").length === 1', 'redo');
  });
  await check('empty colored notes persist and tall note editing uses the full available height', async () => {
    await click('Add note');
    await click('Sage note');
    const id = await execute('return document.querySelector(".note-editor").closest(".board-item").dataset.id');
    await click('Done editing note');
    await waitFor('return !document.querySelector(".note-editor") && document.querySelectorAll(".board-item.note").length === 2', 'empty colored note committed');
    const selector = `[data-id="${id}"]`;
    assert.equal(await execute('return document.querySelector(arguments[0]).dataset.noteColor', [selector]), 'sage');
    assert.equal(await execute('return document.querySelector(arguments[0]).querySelector(".item-content").textContent', [selector]), '');
    await click('Undo');
    await waitFor('return document.querySelectorAll(".board-item.note").length === 1', 'empty note undone');
    await click('Redo');
    await waitFor('return document.querySelectorAll(".board-item.note").length === 2', 'empty note restored');
    assert.equal(await execute('return document.querySelector(arguments[0]).dataset.noteColor', [selector]), 'sage');
    const center = await execute('const box = document.querySelector(arguments[0]).getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };', [selector]);
    await request('POST', `/session/${session}/actions`, { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', duration: 0, x: center.x, y: center.y, origin: 'viewport' },
      { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
      { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
    ] }] });
    await waitFor('return !!document.querySelector(".note-editor")', 'empty note reopened inline');
    await execute(`const editor = document.querySelector('.note-editor'); editor.value = arguments[0]; editor.dispatchEvent(new Event('input', { bubbles: true }));`, [Array.from({ length: 28 }, (_, index) => `Native note line ${index + 1}`).join('\n')]);
    const dimensions = await execute(`const editor = document.querySelector('.note-editor'); const note = editor.closest('.board-item');
      return { editorHeight: editor.clientHeight, noteHeight: note.clientHeight, scrollHeight: editor.scrollHeight, viewportHeight: innerHeight, maxHeight: getComputedStyle(editor).maxHeight };`);
    launchDiagnostics.tallNoteEditor = dimensions;
    assert(dimensions.noteHeight > dimensions.viewportHeight * 0.5, JSON.stringify(dimensions));
    assert(dimensions.editorHeight >= dimensions.noteHeight - 2, JSON.stringify(dimensions));
    assert(dimensions.scrollHeight <= dimensions.editorHeight + 2, JSON.stringify(dimensions));
    await click('Done editing note');
    await waitFor('return !document.querySelector(".note-editor")', 'tall note committed');
    await click('Fit all');
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
  await check('resized images retain native pixel detail after ordinary wheel zoom', async () => {
    await click('Reset zoom');
    const source = await execute(`const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 512;
      const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 1920, 512);
      context.fillStyle = 'black'; for (let x = 0; x < 1920; x += 4) context.fillRect(x, 0, 2, 512);
      return canvas.toDataURL('image/png');`);
    const fixture = resolve('src-tauri/.tools/fixtures/native-detail.png');
    writeFileSync(fixture, Buffer.from(source.split(',')[1], 'base64'));
    const input = await request('POST', `/session/${session}/element`, { using: 'css selector', value: '#image-input' });
    await request('POST', `/session/${session}/element/${input['element-6066-11e4-a52e-4f735466cecf']}/value`, { text: fixture });
    await waitFor('return !!document.querySelector("img[alt=\\"native-detail.png\\"]")?.complete', 'detail pattern imported');
    const imageSelector = 'img[alt="native-detail.png"]';
    await waitFor('return document.querySelector("#save-status").textContent === "Saved on this device"', 'detail import committed');
    await request('POST', `/session/${session}/execute/async`, { script: 'const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => done(true)));', args: [] });
    const geometry = await execute(`const image = document.querySelector(arguments[0]); const box = image.getBoundingClientRect();
      const handle = image.closest('.board-item').querySelector('[data-testid="resize-handle"]').getBoundingClientRect();
      return { width: box.width, height: box.height, x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };`, [imageSelector]);
    launchDiagnostics.imageResizeStart = geometry;
    assert.equal(await execute('return document.elementFromPoint(Math.round(arguments[0]), Math.round(arguments[1]))?.dataset.testid', [geometry.x, geometry.y]), 'resize-handle', 'Resize handle must be the visible hit target');
    assert.equal(geometry.width, 480);
    await execute(`window.__resizeEvents = []; window.__resizeTrace = new AbortController(); for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      document.querySelector('#canvas').addEventListener(type, event => { if (window.__resizeEvents.length < 100) window.__resizeEvents.push({ type, x: event.clientX, y: event.clientY, buttons: event.buttons, pointer: event.pointerId, target: event.target.className }); }, { signal: window.__resizeTrace.signal });
    }`);
    await request('POST', `/session/${session}/actions`, { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', duration: 0, x: Math.round(geometry.x), y: Math.round(geometry.y), origin: 'viewport' },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: 0, x: Math.round(geometry.x - geometry.width * 0.75), y: Math.round(geometry.y - geometry.height * 0.75), origin: 'viewport' },
      { type: 'pointerUp', button: 0 },
    ] }] });
    const smallWidth = await execute('return document.querySelector(arguments[0]).getBoundingClientRect().width', [imageSelector]);
    launchDiagnostics.imageResizeEvents = await execute('window.__resizeTrace.abort(); delete window.__resizeTrace; const events = window.__resizeEvents; delete window.__resizeEvents; return events');
    assert(Math.abs(smallWidth - 120) < 1, `Expected 120px placement after resize, received ${smallWidth}`);
    await request('GET', `/session/${session}/screenshot`); // Ensure the small placement was actually rasterized.
    for (let step = 0; step < 40; step++) {
      const width = await execute('return document.querySelector(arguments[0]).getBoundingClientRect().width * devicePixelRatio', [imageSelector]);
      if (Math.abs(width - 1920) < 0.05) break;
      await execute(`const box = document.querySelector(arguments[0]).getBoundingClientRect();
        document.querySelector('#canvas').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
          clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, deltaY: -Math.min(100, Math.log(1920 / (box.width * devicePixelRatio)) / 0.002) }));`, [imageSelector]);
      await request('POST', `/session/${session}/execute/async`, { script: 'const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => done(true)));', args: [] });
    }
    const physicalWidth = await execute('return document.querySelector(arguments[0]).getBoundingClientRect().width * devicePixelRatio', [imageSelector]);
    assert(Math.abs(physicalWidth - 1920) < 0.1, `Expected original physical width, received ${physicalWidth}`);
    assert.equal(await execute('return document.querySelector(arguments[0]).getAttribute("src")', [imageSelector]), source);
    async function screenDetail() {
      const screenshot = await request('GET', `/session/${session}/screenshot`);
      const detail = await request('POST', `/session/${session}/execute/async`, {
        script: `const [base64, selector, done] = arguments; (async () => {
          const screenshot = new Image(); screenshot.src = 'data:image/png;base64,' + base64; await screenshot.decode();
          const box = document.querySelector(selector).getBoundingClientRect();
          const scaleX = screenshot.width / innerWidth, scaleY = screenshot.height / innerHeight;
          const x = Math.round((box.x + box.width / 2) * scaleX) - 128;
          const y = Math.round((box.y + box.height / 2) * scaleY) - 16;
          const canvas = document.createElement('canvas'); canvas.width = screenshot.width; canvas.height = screenshot.height;
          const context = canvas.getContext('2d'); context.drawImage(screenshot, 0, 0);
          const pixels = context.getImageData(x, y, 256, 32).data;
          let black = 0, white = 0, contrast = 0, pairs = 0;
          for (let row = 0; row < 32; row++) for (let column = 0; column < 256; column++) {
            const index = (row * 256 + column) * 4;
            if (pixels[index] < 40) black++; if (pixels[index] > 215) white++;
            if (column) { contrast += Math.abs(pixels[index] - pixels[index - 4]); pairs++; }
          }
          return { blackFraction: black / 8192, whiteFraction: white / 8192, adjacentContrast: contrast / pairs, dpr: devicePixelRatio, screenshotWidth: screenshot.width, physicalLeft: box.x * scaleX, physicalWidth: box.width * scaleX };
        })().then(done, error => done({ failure: String(error) }));`, args: [screenshot, imageSelector],
      });
      return { screenshot, detail };
    }
    const { screenshot, detail } = await screenDetail();
    writeFileSync('test-results/desktop-image-detail.png', Buffer.from(screenshot, 'base64'));
    launchDiagnostics.imageDetail = detail;
    assert.equal(detail.failure, undefined, detail.failure);
    // Two-source-pixel stripes retain solid dark/light interiors across any
    // fractional placement phase. Quarter-resolution rasterization averages
    // each complete black/white period to gray, so the negative control still
    // detects lost detail without depending on physical-pixel alignment.
    assert(detail.blackFraction > 0.20 && detail.whiteFraction > 0.20 && detail.adjacentContrast > 110, JSON.stringify(detail));
    // Negative control: verify screenshot analysis detects real downsampling.
    await request('POST', `/session/${session}/execute/async`, { script: `const [selector, done] = arguments;
      const image = document.querySelector(selector); const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 128;
      canvas.getContext('2d').drawImage(image, 0, 0, 480, 128); image.src = canvas.toDataURL('image/png'); image.decode().then(() => done(true), error => done(String(error)));`, args: [imageSelector] });
    const negative = (await screenDetail()).detail;
    launchDiagnostics.imageDetailNegativeControl = negative;
    assert(negative.blackFraction < 0.05 && negative.whiteFraction < 0.05 && negative.adjacentContrast < 10, JSON.stringify(negative));
    await execute('document.querySelector(arguments[0]).src = arguments[1]', [imageSelector, source]);
    await click('Fit all');
  });
  await check('Ctrl+C exposes original image pixels to Windows clipboard consumers and Ctrl+V pastes them', async () => {
    assert.deepEqual(launchDiagnostics.clipboardApi, { secureContext: true, clipboardWrite: 'function', clipboardItem: 'function' });
    const probe = await startClipboardProbe();
    const imageSelector = 'img[alt="native-detail.png"]';
    const imageCount = await execute('return document.querySelectorAll(".board-item img").length');
    const point = await execute('const box = document.querySelector(arguments[0]).getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };', [imageSelector]);
    await request('POST', `/session/${session}/actions`, { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', duration: 0, x: point.x, y: point.y, origin: 'viewport' },
      { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
    ] }] });
    await execute('document.querySelector("#canvas").focus()');
    const shortcut = key => request('POST', `/session/${session}/actions`, { actions: [{ type: 'key', id: 'keyboard', actions: [
      { type: 'keyDown', value: '\uE009' }, { type: 'keyDown', value: key }, { type: 'keyUp', value: key }, { type: 'keyUp', value: '\uE009' },
    ] }] });
    await shortcut('c');
    await waitFor('return document.querySelector("#toast").textContent.includes("Image copied")', 'image copied to OS clipboard');
    const copied = await probe.command('read');
    assert.equal(copied.image, true, 'Windows Clipboard.GetImage must read the copied PNG');
    assert.equal(copied.width, 1920);
    assert.equal(copied.height, 512);
    const expected = Array.from({ length: 8 }, (_, x) => [x % 4 < 2 ? 0 : 255, x % 4 < 2 ? 0 : 255, x % 4 < 2 ? 0 : 255, 255]).flat();
    assert(copied.samples.flat().length === expected.length && copied.samples.flat().every((value, index) => value === expected[index]), 'Windows clipboard pixels must match the generated fixture');
    // Only restore over clipboard content verified to be our own fixture.
    await probe.command('claim');
    launchDiagnostics.windowsClipboardImage = copied;
    await shortcut('v');
    await waitFor(`return document.querySelectorAll('.board-item img').length === ${imageCount + 1}`, 'native clipboard pasted into board');
    const pasted = await request('POST', `/session/${session}/execute/async`, {
      script: `const done = arguments[arguments.length - 1]; (async () => {
        const image = document.querySelector('.board-item.selected img'); await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return { width: image.naturalWidth, height: image.naturalHeight, samples: Array.from(context.getImageData(0, 20, 8, 1).data) };
      })().then(done, error => done({ failure: String(error) }));`, args: [],
    });
    assert.equal(pasted.width, 1920);
    assert.equal(pasted.height, 512);
    assert(pasted.samples.length === expected.length && pasted.samples.every((value, index) => value === expected[index]), 'Pasted clipboard pixels must match the generated fixture');
    launchDiagnostics.clipboardRestore = await probe.command('restore');
    probe.child.stdin.end();
    clipboardProbe = undefined;
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
    await writeNote('Unsaved native close protection');
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
    await writeNote('Recovery restored before close');
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
  if (clipboardProbe) {
    try { launchDiagnostics.clipboardRestore = await clipboardProbe.command('restore'); }
    catch (error) { launchDiagnostics.clipboardRestoreFailure = error.message; }
    clipboardProbe.child.stdin.end();
    clipboardProbe.child.kill();
  }
  if (session) await request('DELETE', `/session/${session}`).catch(() => {});
  driver?.kill();
  let cleanupError;
  if (elevatedPolicy && existsSync(policyState)) {
    try { policy('Restore'); launchDiagnostics.policyRestored = true; }
    catch (error) { cleanupError = error; launchDiagnostics.policyRestoreFailure = error.stack; }
  }
  launchDiagnostics.profileEntries = existsSync(profile) ? readdirSync(profile) : [];
  launchDiagnostics.devToolsActivePortExists = existsSync(resolve(profile, 'EBWebView/DevToolsActivePort'));
  writeFileSync('test-results/desktop-launch.json', JSON.stringify(launchDiagnostics, null, 2));
  writeFileSync('test-results/desktop-driver.log', driverLog);
  if (cleanupError) throw cleanupError;
}
