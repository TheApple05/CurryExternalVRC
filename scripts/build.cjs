const { copyFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = readFileSync(path.join(root, 'VRCclient.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/);
if (!script) throw new Error('Frontend script missing');
// Extract the script so the desktop CSP never needs unsafe-inline JavaScript.
mkdirSync(path.join(root, 'dist'), { recursive: true });
mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true });
copyFileSync(path.join(root, 'assets', 'icon.svg'), path.join(root, 'dist', 'assets', 'icon.svg'));
writeFileSync(path.join(root, 'dist', 'app.js'), script[1]);
writeFileSync(path.join(root, 'dist', 'index.html'), html.replace(script[0], '<script src="app.js"></script>'));
