# Kikoenai

**English** / [简体中文](README.zh-CN.md)

An unofficial, third-party desktop client for **Kikoeru**-compatible servers, built with Electron, Vue 3 and Material 3. Windows-first.

> **Not affiliated with Kikoeru, kikoeru-express, or any content site.**
> This project contains no audio, video, subtitle or image content, no credentials, and no telemetry.
> It is a client only: you point it at a server you are allowed to use.

---

## What it is

Kikoeru servers expose a REST API for browsing doujin voice works, streaming their tracks, and reading subtitles. Kikoenai wraps that API in a desktop shell with a native-feeling player: offline downloads, resume-on-restart, subtitle auto-binding, desktop lyrics, and a Windows installer.

It is **not** a server, not a scraper, not a downloader for arbitrary sites, and not a redistribution of anyone's library.

## Features

### Library and discovery
- Work wall with ranking badges, subtitle/R18 markers, rating and download counts.
- Search with namespace syntax: `$tag:値$`, `$va:値$`, `$circle:値$`, `$-tag:除外$`, quoted phrases, and plain `-exclude`.
- Namespace autocomplete, recent searches, sort menu, infinite scrolling.
- Category browsing by tag / circle / voice actor.
- Recommendation page driven by a locally generated anonymous profile.
- Work detail with tag voting, favourite toggle, and "add to playlist".

### Playback
- Single `<video>` element for both audio and video works; no extension filtering inside a folder.
- Repeat off / all / one, shuffle, playback queue, speed 0.75×–2×, volume, mute.
- Sleep timer (30 minutes) and "stop after this track" at the data layer.
- Resume where you left off (saved every 5 seconds, restored on load).
- Local-first playback: if a track was downloaded, it plays from disk; if that file is missing, it falls back to streaming once and keeps the position.
- Video works get a fixed-size viewer window with a draggable seek bar and opt-in fullscreen; audio-only works never open it.

### Subtitles and lyrics
- LRC, SRT, ASS/SSA, VTT and plain-text scripts.
- Encoding detection: UTF-8, Shift-JIS, GBK, Big5, EUC-KR.
- Auto-binding is **scoped to the folder the track lives in**, so bonus/ringtone folders never inherit the main story's subtitles; the only global fallback is a unique exact-name match.
- Manual binding per track, remembered across sessions.
- Global offset (±0.5 s) and per-line adjustment data.
- Floating desktop lyrics window, optionally placed on another monitor.

### Downloads and offline
- Download every downloadable file in a work: audio, video, subtitles, images, PDF.
- Concurrency 1–5, enforced in the main process queue.
- Pause / resume, HTTP Range continuation, ETag mismatch detection (falls back to a full re-download).
- Task list persisted to disk; unfinished tasks resume after a restart.
- Duplicate names get a ` (n)` suffix; Windows reserved names are sanitised.
- Download URLs must be public http(s): loopback, private and reserved addresses are rejected, except the server host you configured yourself.

### Desktop integration
- Frameless window with custom controls, smooth fullscreen animation.
- System tray with show/hide and playback actions.
- Global media keys and Windows taskbar thumbnail buttons.
- Single instance, close-to-tray or quit-on-close (configurable).
- Installer (shortcuts + Add/Remove Programs entry) or fully portable folder.
- Daily log files under the app data directory.

## Requirements

- Windows 10/11 (x64). The UI is Electron; other platforms are untested.
- A Kikoeru-compatible server (for example a self-hosted `kikoeru-express`) reachable over HTTP(S).
- For building: Node.js 20+ and npm.

## Install

Download the latest build from the [Releases](../../releases) page (`Kikoenai-<version>-win-x64.zip`), extract it, then either run the installer or the portable executable.

### Installer
1. Download the release archive and extract it anywhere.
2. Run `安装.bat` (or `Kikoenai.exe --install`).
3. Pick an install directory, wait for the file copy, optionally launch.

The installer creates Desktop and Start Menu shortcuts and registers an uninstall entry in **Apps & features**. Uninstalling removes the program and shortcuts only; downloaded works and account data stay.

### Portable
Run `Kikoenai.exe` from the extracted folder. Nothing is written outside `%APPDATA%\KikoeruPC` (settings, task list, logs) and your download folder.

> The executable is not code-signed. Windows SmartScreen may warn on first launch; use "More info → Run anyway" if you trust the source you downloaded it from.

## Build from source

```bash
npm ci
npm run typecheck
npm test
npm run package
```

`npm run package` builds the renderer, copies the Electron runtime into `release/Kikoenai`, renames the executable, writes version metadata and verifies that the packaged `dist/index.html` matches the freshly built one. Output is a portable directory.

For development:

```bash
npm run dev          # Vite dev server
npm run app:dev      # Electron with the dev server
```

## Configuration

All settings live in the app: **Settings → Server & network / Downloads / Close behavior / Logs**.

- **Server URL** — any http(s) base URL. Defaults to a public Kikoeru-compatible site so the app works out of the box; change it to your own server at any time. A relaunch is required after changing it.
- **Upstream proxy** — `auto` (cached → common local ports → system → direct), `system`, `direct`, or a custom rule such as `http://127.0.0.1:7897` / `socks5://127.0.0.1:1080`.
- **Environment overrides** — `KIKOERU_TARGET` and `KIKOERU_PROXY` take precedence over saved settings.

### Data locations

| Path | Contents |
| --- | --- |
| `%APPDATA%\KikoeruPC\config.json` | server URL, proxy mode, download settings, close behavior |
| `%APPDATA%\KikoeruPC\downloads.json` | download task list (used for resume) |
| `%APPDATA%\KikoeruPC\logs\YYYY-MM-DD.log` | main-process and renderer logs |
| `%APPDATA%\KikoeruPC\Local Storage` | login tokens, playback positions, subtitle bindings |
| Chosen download folder | downloaded files, one `RJxxxxxxx` folder per work by default |

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Seek −5 s / +5 s (`Shift`: 30 s) |
| `↑` / `↓` | Volume |
| `M` | Mute |
| `N` / `P` | Next / previous track |
| `/` | Jump to search |
| `F11` | Toggle fullscreen |
| `Esc` | Exit fullscreen / close the now-playing sheet / close the video window |

## Architecture notes

- The renderer is served from a custom `app://` protocol, so it is same-origin with its own proxy endpoints and needs no CORS allowances from the server.
- `/kapi/*` is forwarded by the main process to the configured server. Redirects are followed only after re-validating the target; responses that end up on loopback/private addresses are discarded.
- `/kmedia?u=` fetches text resources (subtitles) through the same guarded path.
- `/local?p=` serves already-downloaded files read-only, restricted to the download roots and supporting HTTP Range so seeking works.
- Credentials never leave the machine; there is no analytics, no crash reporting and no auto-update channel.

## Troubleshooting

**A work plays video but there is no sound.** The audio track is probably AC-3, E-AC-3 or DTS. Chromium cannot decode those codecs; the app detects it and tells you which codec it found. Download the file and open it in a player that supports it.

**Nothing loads after changing the server.** Restart the app (Settings → Server & network → Save → Restart now). The main process reads the server URL at startup.

**Downloads fail behind a proxy.** Set the proxy mode explicitly instead of `auto`, then restart.

**Something is broken.** Open **Settings → Logs → Open folder** and read today's file; the startup line records the server, proxy and mode in use.

## Known limitations

- Windows-first; the code is cross-platform Electron but only Windows was tested.
- No code signing and no auto-update; updates are manual folder replacement.
- Subtitle per-line offset exists in the data layer but has no UI yet.
- Sleep timer UI exposes 30 minutes only.
- Playlists are read/create/delete; renaming is not implemented.

## License

**PolyForm Strict License 1.0.0** — see [LICENSE](LICENSE).

In short: you may use this software for **noncommercial** purposes only. You may **not** distribute it and you may **not** make changes or derivative works. Because the license forbids modifications, this project does not accept code contributions.

If you need different terms, contact the author.

## Third-party notices

- Electron — MIT
- Vue 3 / vue-router — MIT
- `@material/material-color-utilities` — Apache-2.0
- Material Symbols icon paths — Apache-2.0

No source code from Kikoeru, kikoeru-express, KikoFlu, Animeko or any content site is included in this repository. The UI follows the public Material 3 design specification; the protocol implementation is based on the publicly documented REST behavior of Kikoeru servers.

## Disclaimer

This software is provided as-is, without warranty of any kind. It is intended for use with servers and content you are legally allowed to access. You are responsible for complying with the law in your jurisdiction and with the terms of the server you connect to. The author does not host, provide or endorse any content.
