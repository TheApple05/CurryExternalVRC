const assert = require('node:assert/strict');
const { readFile, mkdir } = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require('playwright-core');

test('browser and Tauri frontend workflows', { timeout: 90000 }, async (t) => {
  const root = path.resolve(__dirname, '..');
  const html = await readFile(path.join(root, 'VRCclient.html'));
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const url = `http://127.0.0.1:${server.address().port}`;

  for (const native of [false, true]) {
    await t.test(native ? 'Tauri command bridge (mocked)' : 'standalone browser', async () => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const avatar = { vrc_id: 'avtr_test', name: 'Test avatar' };
        const saved = { picks: { avatar: [], world: [] }, accounts: [], players: [] };
        const opened = [];
        let failSave = false;
        if (native) {
          await page.exposeFunction('testInvoke', async (command, args) => {
            if (command === 'load_state') return saved;
            if (command === 'save_state') {
              if (failSave) throw new Error('Disk write failed');
              Object.assign(saved, structuredClone(args.state));
              return;
            }
            if (command === 'search_avatars') return { avatars: [avatar] };
            if (command === 'open_external') { opened.push(args.url); return; }
            throw new Error(`Unexpected command ${command}`);
          });
          await page.addInitScript(() => { window.__TAURI__ = { core: { invoke: window.testInvoke } }; });
        } else {
          await context.route('https://api.avtrdb.com/**', (route) => route.fulfill({
            contentType: 'application/json', body: JSON.stringify({ avatars: [avatar] }),
          }));
        }
        await page.goto(url);
        await page.locator('#avatar-results').getByText('Test avatar', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Save pick', exact: true }).click();
        if (native) await page.waitForFunction(() => document.querySelector('#message').textContent === 'Saved locally.');
        await page.getByRole('tab', { name: 'Saved Avatars', exact: true }).click();
        await page.locator('#saved-view').getByText('Test avatar', { exact: true }).waitFor();
        await page.getByRole('tab', { name: 'Saved Worlds', exact: true }).click();
        await page.getByLabel('Name', { exact: true }).fill('Test world');
        await page.getByLabel('VRChat ID or page URL', { exact: true }).fill('wrld_test');
        await page.getByRole('button', { name: 'Add pick', exact: true }).click();
        await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
        await page.getByLabel('Browser profile name', { exact: true }).fill('Work');
        await page.getByRole('button', { name: 'Add profile shortcut', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#account-message').textContent === 'Account labels updated locally.');
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export labels', exact: true }).click();
        assert.equal((await downloadPromise).suggestedFilename(), 'curryclient-account-labels.json');
        await page.getByRole('tab', { name: 'Player Tracker', exact: true }).click();
        await page.getByLabel('Paste VRChat account links', { exact: true }).fill('https://vrchat.com/home/user/usr_test');
        await page.getByRole('button', { name: 'Add to list', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#player-message').textContent.startsWith('Added 1;'));
        await page.reload();
        await page.getByRole('tab', { name: 'Saved Worlds', exact: true }).click();
        await page.getByText('Test world', { exact: true }).waitFor();
        await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
        await page.getByText('Work', { exact: true }).waitFor();
        if (native) {
          assert.deepEqual(saved.players, ['usr_test']);
          await page.getByRole('link', { name: 'Log in to VRChat', exact: true }).click();
          await page.waitForTimeout(50);
          assert.deepEqual(opened, ['https://vrchat.com/home/login']);
          await page.getByRole('tab', { name: 'World Browser', exact: true }).click();
          await page.getByLabel('World tags', { exact: true }).fill('chill ocean');
          await page.getByRole('button', { name: 'Search worlds', exact: true }).click();
          await page.waitForTimeout(50);
          assert.equal(opened.at(-1), 'https://vrclist.com/?type=search&sort=recent&tags=chill+ocean');
          failSave = true;
          await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
          await page.getByLabel('Browser profile name', { exact: true }).fill('Unsaved');
          await page.getByRole('button', { name: 'Add profile shortcut', exact: true }).click();
          await page.getByText(/Could not save changes:/).waitFor();
          assert.deepEqual(saved.accounts, ['Work']);
        }
        await page.getByRole('tab', { name: 'HTML Modules', exact: true }).click();
        await page.locator('#module-files').setInputFiles({
          name: 'preview.html', mimeType: 'text/html',
          buffer: Buffer.from('<h1>Preview</h1><script>document.body.dataset.executed="yes"</script>'),
        });
        const frame = page.frameLocator('#module-preview');
        await frame.getByRole('heading', { name: 'Preview' }).waitFor();
        assert.equal(await frame.locator('body').getAttribute('data-executed'), null);
        assert.equal(await page.locator('#module-preview').getAttribute('sandbox'), '');
        await page.getByRole('button', { name: 'Remove preview.html', exact: true }).click();
        assert.equal(await page.locator('#module-preview').isHidden(), true);
        await page.getByRole('tab', { name: 'Avatar Browser', exact: true }).click();
        await mkdir(path.join(root, 'test-results'), { recursive: true });
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 860 });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await page.screenshot({ path: path.join(root, 'test-results', `${native ? 'tauri-bridge' : 'browser'}-${width}.png`), fullPage: true });
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
  await t.test('native load failure blocks edits and never resets the file', async () => {
    const context = await browser.newContext();
    try {
      await context.addInitScript(() => {
        window.__TAURI__ = { core: { invoke: async () => { throw new Error('Invalid JSON'); } } };
      });
      const page = await context.newPage();
      await page.goto(url);
      await page.getByRole('alert').filter({ hasText: 'Could not load saved data' }).waitFor();
      assert.equal(await page.getByRole('tab').count(), 0);
    } finally { await context.close(); }
  });
});
