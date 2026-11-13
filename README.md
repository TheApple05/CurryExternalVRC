# CurryClient — Rust + Tauri

A Windows VRChat companion, forked from [oxykek/CurryExternalVRC](https://github.com/oxykek/CurryExternalVRC). The desktop app now runs on **Tauri 2 and Rust**, using the system WebView2 runtime. Electron and its bundled Chromium/Node runtime have been removed.

## Features

- AVTRDB avatar search, random discovery, pagination and saved avatars.
- World discovery through VRClist, plus saved worlds.
- Separate VRCMods search.
- Session-only HTML modules, previewed in script-disabled sandboxed frames.
- Saved VRChat profile links. “Player Tracker” is a bookmarks list; it does not monitor presence or activity.
- Account labels with JSON import/export. Login and signup open in the default browser; credentials, cookies and browser profiles are never read.
- The existing featured avatar links remain ordinary browser shortcuts.

The original interface and standalone browser mode are retained. Rust owns desktop catalog requests, response normalization, validated persistence, and approved external link opening. The HTML/JavaScript layer renders the interface and handles browser file selection.

## Run from source

Install [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/): Rust (MSVC toolchain), Visual Studio C++ Build Tools, WebView2, and Node.js 22+.

```sh
npm ci
npm start
```

No frontend framework or development server is required. A small build script extracts the frontend JavaScript into `dist/app.js` so the desktop CSP does not require inline scripts.

## Build Windows binaries

```sh
npm run pack
npm run dist:win
```

The executable is `src-tauri/target/release/curryclient.exe`; the NSIS installer is under `src-tauri/target/release/bundle/nsis/`. The installer bootstraps WebView2 when missing. Builds are unsigned and have no automatic updater. `Desktop` GitHub Actions builds Windows artifacts on pushes and PRs.

## Test

```sh
npm run build:frontend
npm run test:rust
npm test
cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings
```

Rust tests cover validation, atomic replacement, invalid/corrupt data preservation, catalog response variants and the external-link allowlist. Frontend tests use installed Chrome through Playwright, covering both standalone mode and a mocked Tauri bridge: bookmarks, profiles, account export, persistence, save/load failures, sandboxed HTML, desktop/mobile layouts and runtime errors.

To additionally test the real debug Tauri app on Windows:

```powershell
cargo build --manifest-path src-tauri/Cargo.toml --locked
$env:CURRYCLIENT_EXECUTABLE = "$PWD\src-tauri\target\debug\curryclient.exe"
npm test
Remove-Item Env:CURRYCLIENT_EXECUTABLE
```

The native test sets `CURRYCLIENT_TEST_DATA_DIR` and `CURRYCLIENT_TEST_CDP_PORT`, both honored **only by debug builds**. Rust passes the test port and temporary WebView directory directly to WebView2 because elevated Windows runners ignore WebView2 environment overrides ([Microsoft explanation](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645)). Release builds have neither this storage override nor built-in remote debugging. Mocked frontend tests do not prove native integration; native checks are reported separately.

## Saved data and migration

Tauri stores avatars, worlds, profile IDs and labels in `%APPDATA%\com.curryclient.tauri\state.json`. Rust validates each full snapshot, writes a synced temporary file beside the destination, and atomically replaces the previous file. Save errors appear in the UI. Corrupt state blocks editing and is preserved for recovery rather than replaced with empty data.

The former Electron profile (`%APPDATA%\CurryClient`) and browser storage are untouched. **There is no automatic migration of Electron/browser bookmarks.** Export account labels from the old app and import them here; that export contains labels only. Avatar/world/profile bookmarks must be re-added. Imported HTML modules last only for the current session.

Standalone mode: open `VRCclient.html` directly. It continues using localStorage and browser catalog requests. Its data remains separate from the Tauri app.

## Native security boundaries

- Only the bundled main window has permission to call the four Rust commands. Remote pages receive no capabilities.
- Browser links must use HTTPS and one exact host: `vrchat.com`, `avtrdb.com`, `vrclist.com`, `vrcmods.com`, or `drive.google.com`. Userinfo, explicit ports and other protocols/hosts are rejected.
- New WebView windows and device permission requests are denied. External navigation cannot replace the app.
- Catalog requests use fixed AVTRDB endpoints, a timeout, no redirects, a response-size limit, explicit-listing filtering and validated IDs/thumbnails.
- Imported HTML remains in `sandbox=""` blob frames, with scripts, popups and top-level navigation disabled.

AVTRDB, VRClist and VRCMods are external services and may change availability or behavior. Windows x64 is the tested target; macOS/Linux packaging and authenticated VRChat sessions require separate validation.

## License

GNU GPL v3.0 only; see [LICENSE](LICENSE). Original upstream authors retain their copyrights. CurryClient is an independent community project, unaffiliated with or endorsed by VRChat.
