const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { _electron } = require('playwright-core');

test('Electron desktop workflows and isolation', { timeout: 90000 }, async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'curryclient-test-'));
  const root = path.resolve(__dirname, '..');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let desktop;
  let page;
  const errors = [];

  t.after(async () => {
    if (desktop) await desktop.close();
    assert.ok(profile.startsWith(path.join(os.tmpdir(), 'curryclient-test-')));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  async function launch() {
    desktop = await _electron.launch({
      executablePath: process.env.CURRYCLIENT_EXECUTABLE || require('electron'),
      args: [...(process.env.CURRYCLIENT_EXECUTABLE ? [] : [root]), `--user-data-dir=${profile}`],
      env,
    });
    assert.equal(path.resolve(await desktop.evaluate(({ app }) => app.getPath('userData'))), profile);
    await desktop.context().route('https://api.avtrdb.com/**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ avatars: [{ vrc_id: 'avtr_desktop_test', name: 'Desktop test avatar' }] }),
    }));
    page = await desktop.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.reload();
    await page.locator('#avatar-results').getByText('Desktop test avatar', { exact: true }).waitFor();
    await desktop.evaluate(({ shell }) => {
      globalThis.testOpenedUrls = [];
      shell.openExternal = async (url) => { globalThis.testOpenedUrls.push(url); };
    });
  }

  await launch();
  await t.test('loads the bundled page with a secure, isolated renderer', async () => {
    assert.equal(await page.title(), 'CurryClient');
    assert.equal(page.url(), 'curryclient://app/');
    assert.deepEqual(await page.evaluate(() => [typeof require, typeof process, isSecureContext]),
      ['undefined', 'undefined', true]);
    const preferences = await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.webSecurity, true);
    assert.equal(preferences.webviewTag, false);
    assert.equal(await desktop.evaluate(({ app }) => app.commandLine.hasSwitch('no-sandbox')), false);
    assert.equal(await page.evaluate(() => Notification.requestPermission()), 'denied');
    assert.equal(await desktop.evaluate(async ({ net }) =>
      (await net.fetch('curryclient://app/electron/main.cjs')).status), 404);
    assert.equal(await desktop.evaluate(async ({ net }) =>
      (await net.fetch('curryclient://other/')).status), 404);
  });

  await t.test('saves bookmarks and account labels', async () => {
    await page.getByRole('button', { name: 'Save pick', exact: true }).click();
    await page.getByRole('tab', { name: 'Saved Avatars', exact: true }).click();
    await page.locator('#saved-view').getByText('Desktop test avatar', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
    await page.getByLabel('Browser profile name', { exact: true }).fill('Desktop test profile');
    await page.getByRole('button', { name: 'Add profile shortcut', exact: true }).click();
    await page.getByText('Desktop test profile', { exact: true }).waitFor();
    await desktop.evaluate(({ session }, exportPath) => {
      globalThis.testDownload = null;
      session.defaultSession.once('will-download', (_event, item) => {
        item.setSavePath(exportPath);
        const filename = item.getFilename();
        item.once('done', (_doneEvent, state) => {
          globalThis.testDownload = { filename, state };
        });
      });
    }, path.join(profile, 'labels.json'));
    await page.getByRole('button', { name: 'Export labels', exact: true }).click();
    await assertEventually(async () => {
      assert.deepEqual(await desktop.evaluate(() => globalThis.testDownload),
        { filename: 'curryclient-account-labels.json', state: 'completed' });
    });
    const backup = JSON.parse(await readFile(path.join(profile, 'labels.json'), 'utf8'));
    assert.deepEqual(backup.accounts, ['Desktop test profile']);
    await page.getByRole('tab', { name: 'World Browser', exact: true }).click();
    await page.getByLabel('World tags', { exact: true }).fill('chill ocean');
    await page.getByRole('button', { name: 'Search worlds', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#world-browser').hidden === false);
    assert.deepEqual(await desktop.evaluate(() => globalThis.testOpenedUrls),
      ['https://vrclist.com/?type=search&sort=recent&tags=chill+ocean']);
  });

  await t.test('opens approved links in the browser and blocks unsafe destinations', async () => {
    await desktop.evaluate(() => { globalThis.testOpenedUrls = []; });
    await page.getByRole('link', { name: 'Log in to VRChat', exact: true }).click();
    await page.evaluate(() => {
      for (const url of ['file:///C:/Windows/win.ini', 'ms-settings:privacy',
        'https://vrchat.com.evil.example/', 'https://user:pass@vrchat.com/',
        'https://vrchat.com:444/', 'http://vrchat.com/']) {
        window.open(url, '_blank');
      }
    });
    await assertEventually(async () => {
      assert.deepEqual(await desktop.evaluate(() => globalThis.testOpenedUrls),
        ['https://vrchat.com/home/login']);
    });
    assert.equal(page.url(), 'curryclient://app/');
    assert.equal(desktop.windows().length, 1);
  });

  await t.test('imports HTML without executing its scripts', async () => {
    await page.getByRole('tab', { name: 'HTML Modules', exact: true }).click();
    await page.locator('#module-files').setInputFiles({
      name: 'preview.html', mimeType: 'text/html',
      buffer: Buffer.from('<h1>Module preview</h1><script>document.body.dataset.executed = "yes"</script>'),
    });
    const preview = page.frameLocator('#module-preview');
    await preview.getByRole('heading', { name: 'Module preview' }).waitFor();
    assert.equal(await preview.locator('body').getAttribute('data-executed'), null);
    assert.equal(await page.locator('#module-preview').getAttribute('sandbox'), '');
    await page.getByRole('button', { name: 'Remove preview.html', exact: true }).click();
    assert.equal(await page.locator('#module-preview').isHidden(), true);
  });

  await t.test('retains saved data across a full app restart', async () => {
    await page.evaluate(() => { location.href = 'https://avtrdb.com/browse'; });
    await assertEventually(async () => {
      assert.equal((await desktop.evaluate(() => globalThis.testOpenedUrls)).at(-1),
        'https://avtrdb.com/browse');
    });
    assert.equal(page.url(), 'curryclient://app/');
    await desktop.close();
    desktop = null;
    await launch();
    await page.getByRole('tab', { name: 'Saved Avatars', exact: true }).click();
    await page.locator('#saved-view').getByText('Desktop test avatar', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
    await page.getByText('Desktop test profile', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await mkdir(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results', 'electron-desktop.png') });
  });
});

async function assertEventually(check) {
  for (let attempt = 0; ; attempt++) {
    try { return await check(); } catch (error) {
      if (attempt >= 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
