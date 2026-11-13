const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, readFile, rm, mkdir } = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require('playwright-core');

test('real Windows Tauri app, Rust commands and restart', {
  skip: !process.env.CURRYCLIENT_EXECUTABLE, timeout: 120000,
}, async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'curryclient-native-'));
  let app, browser, page;
  const errors = [];
  async function stop() {
    if (browser) { await browser.close(); browser = null; }
    if (app && app.exitCode === null) {
      const exited = once(app, 'exit');
      app.kill();
      await exited;
    }
    app = null;
  }
  t.after(async () => {
    await stop();
    assert.equal(path.dirname(profile), os.tmpdir());
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  async function launch() {
    const socket = net.createServer();
    await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    app = spawn(process.env.CURRYCLIENT_EXECUTABLE, [], { windowsHide: true, env: {
      ...process.env,
      CURRYCLIENT_TEST_DATA_DIR: profile,
      WEBVIEW2_USER_DATA_FOLDER: path.join(profile, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
    }, stdio: 'pipe' });
    app.on('error', (error) => errors.push(error.message));
    let stderr = '';
    app.stderr.on('data', (data) => { stderr += data.toString(); });
    for (let attempt = 0; attempt < 150; attempt++) {
      if (app.exitCode !== null) throw new Error(`Tauri exited ${app.exitCode}: ${stderr}`);
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 500 });
        break;
      } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.ok(browser, `WebView2 debugging unavailable: ${stderr}`);
    const context = browser.contexts()[0];
    page = context.pages()[0] || await context.waitForEvent('page');
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('tab', { name: 'Accounts', exact: true }).waitFor();
    assert.equal(await page.title(), 'CurryClient');
    assert.equal(new URL(page.url()).hostname, 'tauri.localhost');
    assert.deepEqual(await page.evaluate(() => [typeof require, typeof process]), ['undefined', 'undefined']);
  }
  await launch();
  await page.waitForFunction(() => !document.querySelector('#avatar-status').textContent.startsWith('Loading'));
  t.diagnostic(`Native live catalog: ${await page.locator('#avatar-status').textContent()}`);
  assert.equal(await page.evaluate(() => Notification.requestPermission()), 'denied');
  await page.evaluate(() => { window.open('https://example.com'); location.href = 'https://example.com'; });
  await page.waitForTimeout(100);
  assert.equal(new URL(page.url()).hostname, 'tauri.localhost');
  assert.equal(browser.contexts()[0].pages().length, 1);
  await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
  await page.getByLabel('Browser profile name', { exact: true }).fill('Native smoke');
  await page.getByRole('button', { name: 'Add profile shortcut', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#account-message').textContent === 'Account labels updated locally.');
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'state.json'))).accounts, ['Native smoke']);
  const denied = await page.evaluate(async () => {
    const invoke = window.__TAURI__.core.invoke;
    const result = [];
    for (const command of [
      ['open_external', { url: 'file:///C:/Windows/win.ini' }],
      ['save_state', { state: { picks: { avatar: [], world: [] }, players: ['bad'], accounts: [] } }],
      ['plugin:opener|open_url', { url: 'https://example.com' }],
    ]) {
      try { await invoke(...command); result.push(false); } catch { result.push(true); }
    }
    return result;
  });
  assert.deepEqual(denied, [true, true, true]);
  await page.getByRole('tab', { name: 'HTML Modules', exact: true }).click();
  await page.locator('#module-files').setInputFiles({
    name: 'native.html', mimeType: 'text/html',
    buffer: Buffer.from('<h1>Native preview</h1><script>document.body.dataset.ran="yes"</script>'),
  });
  await page.frameLocator('#module-preview').getByRole('heading', { name: 'Native preview' }).waitFor();
  assert.equal(await page.frameLocator('#module-preview').locator('body').getAttribute('data-ran'), null);
  await stop();
  await launch();
  await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
  await page.getByText('Native smoke', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'HTML Modules', exact: true }).click();
  assert.equal(await page.locator('#module-preview').isHidden(), true);
  const resultDir = path.resolve(__dirname, '..', 'test-results');
  await mkdir(resultDir, { recursive: true });
  await page.screenshot({ path: path.join(resultDir, 'native-tauri.png') });
  assert.deepEqual(errors, []);
});
