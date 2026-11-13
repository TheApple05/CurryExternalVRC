# CurryClient

A VRChat companion app for Windows, powered by Electron, with tools for browsing avatars, discovering worlds, and managing HTML modules. The standalone browser version remains available.

![CurryClient](https://via.placeholder.com/1000x300?text=CurryClient)

## Features

### Avatar Browser
- Search for VRChat avatars.
- Browse avatar listings.
- View avatar information.
- Save avatars for later.
- Keep avatar browsing separate from VRCMods.

### World Browser
- Discover public VRChat worlds.
- Search worlds using tags.
- Browse world listings through VRClist.
- Save worlds for later.
- Designed to sit underneath Avatar Browser.

### VRCMods
- Dedicated VRCMods section.
- Kept separate from the Avatar Browser and World Browser.

### HTML Modules
- Import HTML module files.
- Preview imported modules.
- Remove modules when no longer needed.

### Additional Tools
- Saved Avatars
- Saved Worlds
- Crash
- Player Tracker
- Accounts
- VRChat Login

## Getting Started

### Desktop app from source

Install Node.js 22 or newer and npm, then run these commands in a clone of this repository:

```sh
npm ci
npm start
```

`npm test` launches the real Electron app with an isolated temporary profile and a mocked avatar catalog. It checks renderer isolation, saved data across restarts, external links, account label exports, and sandboxed module previews. It does not test authenticated VRChat sessions or live catalog availability.

### Windows builds

```sh
npm run pack
npm run dist:win
```

`pack` creates an unpacked app for the current platform. `dist:win` produces a Windows x64 installer (`CurryClient-Setup-1.0.0.exe`) and portable app (`CurryClient-Portable-1.0.0.exe`) in `dist/`. Build Windows packages on Windows. The Desktop GitHub Actions workflow tests and builds them, then uploads a `CurryClient-Windows` artifact on each PR and push.

To test an unpacked Windows build in PowerShell:

```powershell
$env:CURRYCLIENT_EXECUTABLE = "$PWD\dist\win-unpacked\CurryClient.exe"
npm test
Remove-Item Env:CURRYCLIENT_EXECUTABLE
```

Builds are unsigned and have no automatic updater. Windows may display an unrecognized-publisher warning.

### Browser mode

Open `VRCclient.html` in a modern browser. No installation or build step is required.

## Data Storage

Saved avatars, worlds, player links, and account labels use local storage. The desktop app stores these in its own Electron user-data directory (`%APPDATA%\CurryClient` on Windows), separately from your browser. Browser data is not migrated automatically.

Account labels support JSON import and export; avatar, world, and player bookmarks are not migrated by a label export. Imported HTML modules last only for the current session. Removing the app's user-data directory or clearing browser storage removes the corresponding saved data.

## Desktop Security

The app serves only its bundled page through a private `curryclient://app/` origin, with a restrictive Content Security Policy. The renderer is sandboxed, context-isolated, and has no Node.js access, preload script, or IPC bridge. Camera, microphone, notifications, and other permission requests are denied.

Approved HTTPS links to VRChat, AVTRDB, VRClist, VRCMods, and Google Drive open in your default system browser. Login and signup remain in that browser; the app does not read browser profiles, credentials, or VRChat sessions. Imported HTML previews retain their script-disabled sandbox.

## External Services

CurryClient uses external services for certain browsing features, including:

- **AVTRDB** — avatar discovery.
- **VRClist** — world discovery.

External services may change their APIs or availability, which can affect related features.

## Compatibility

The desktop build targets Windows x64. macOS and Linux packaging have not been validated. Browser mode requires a modern browser with JavaScript enabled.

## Disclaimer

CurryClient is an independent community project and is not an official VRChat product.

VRChat is a trademark of its respective owner. This project is not affiliated with or endorsed by VRChat.

Use the client responsibly and follow the rules and terms of the services you access.

## License

CurryClient is licensed under the **GNU General Public License v3.0 (GPL-3.0)**.

You are free to:
- Use the software.
- Study and modify the source code.
- Redistribute original or modified versions.
- Share your modifications under the same license.

All distributions and modifications must comply with the GNU GPL v3.0 terms.

See the [LICENSE](LICENSE) file for the full license text.

**SPDX-License-Identifier:** GPL-3.0-only

---

**CurryClient** — Your VRChat workspace, all in one place.
