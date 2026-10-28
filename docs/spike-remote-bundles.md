# Spike: serving a downloaded web bundle

Throwaway spike for plan 56, phase 1. Not for merging.

## Result

`Context::set_assets` works. In `src-tauri/src/web_bundle.rs`, a custom `tauri::Assets`
serves an installed `dist/spa` from `<app data>/web-bundles/<version>/`. If no bundle
is active, or its folder has no `index.html`, the embedded bundle stays in place. The custom-scheme route and a
local-storage migration are not needed.

Checked against the Tauri version that actually builds: `Cargo.lock` pins `tauri 2.10.2`.
`Cargo.toml` says `2.2.4`, but that is only the minimum.

## Why it keeps login, local storage, the card reader and MQTT

- **Same origin.** The pages are still served through Tauri's own protocol:
  `tauri://localhost` on macOS and `http://tauri.localhost` on Windows. Local storage
  keeps the device token, session token, fleet company and client ids
  (`useAuthStore`, `useFleetStore`, `useFlespiStore`), and they stay readable. Nothing
  has to be migrated.
- **IPC does not depend on the HTML.** Tauri adds `__TAURI_INTERNALS__` through
  webview initialisation scripts, not through `index.html`. `invoke` for
  `update_card`, `update_server`, `remove_card`, `manual_sync_cards` and
  `app_connection`, `listen`, and `emit('frontend-loaded')` all work from a downloaded
  bundle. The capability `default.json` is matched by window label `main` and the
  local origin, and neither changes.
- **The router uses hash mode** (`quasar.config.ts`), so every navigation loads
  `index.html`, and Tauri's own `get_asset` fallback chain still applies.
- **The card reader (PC/SC) and MQTT (rumqttc) run natively.** The loader does not
  touch them. They start on `frontend-loaded` either way.

## Design choices

- **The bundle is chosen once, before the event loop starts.** It is resolved as
  `dirs::data_dir()/<identifier>/web-bundles`, the same path
  `app.path().app_data_dir()` returns. It is not resolved in `Assets::setup`, because
  Tauri calls that only after the windows are built
  (`tauri-2.10.2/src/app.rs:2372-2377`). A first request could then get the embedded
  `index.html` while later requests get downloaded chunks.
- **The fallback covers the whole bundle, not single files.** An installed bundle is
  used only if its `index.html` exists, and then every file comes from that bundle.
  Vite chunk names are hashed, so falling back file by file to the embedded bundle
  could never repair a broken download. It could only mix two versions.
- **Keys that leave the bundle are refused.** Any key with a `..`, root or drive
  component is rejected (`AssetKey` keeps `..`).
- **`csp_hashes` is empty.** A Vite build has no inline scripts, so the CSP needs no
  hashes for a downloaded bundle. If a bundle ever ships an inline script, the CSP
  blocks it.
- In dev, `devUrl` is used and the loader is never asked for anything.

## Install and rollback

- **`install_web_bundle(url, version, sha256, signature)`.** It downloads the zip over
  HTTPS (64 MiB cap). It refuses a blocked or already-active version. It checks the
  sha256, and the minisign signature against the updater public key compiled into the
  build (`plugins.updater.pubkey`), decoded the way the Tauri updater does. It unpacks
  into `web-bundles/.staging` (`enclosed_name`, so no `..`, roots or drives; no links;
  at most 10 000 entries and 256 MiB; `index.html` required). Then it renames the folder
  to `web-bundles/<version>` and stages it: active = version, trial = `installed`, and
  previous = the last confirmed version. Folders that are neither active nor previous
  are removed.
- **A launch** reads `web-bundles/state.json`. Trial `installed` becomes `launched`, and
  the bundle is served. If a launch finds the trial still `launched`, the previous
  launch never confirmed itself. The version is then blocked, previous (or the
  built-in bundle) becomes active, and `rolled_back` records it.
- **`bundle_ready`** ends the trial and returns the version rolled back at this launch,
  once. `TachoMainComponent` calls it right after `frontend-loaded` is emitted and shows
  a warning when it returns a version. The launch also logs the rollback.
- **`web_bundle_status`** returns the state, including `rolled_back` and `blocked`.
- **CSP** (`tauri.conf.json`): `'self'` for scripts, inline styles for Quasar, and
  `connect-src` for IPC, `api.transportklok.nl` and `api.trackmijn.nl`. The zip is
  downloaded by Rust, so S3 download hosts need no CSP entry. A bundle API host other
  than `api.transportklok.nl` must be added.

## Open for the next phases

- The frontend side: a web-bundle client for `/bundles/web/latest`, an installer for
  `createLiveBundleUpdater` that calls `install_web_bundle` and an app restart.
- Fit it together with the native updater (`application-bundle-updates.md`). An
  updated native shell with a newer embedded bundle must not keep serving an older
  downloaded one.

## Tests

`generate_context!` needs a built `dist/spa`, so build that first:

```bash
npm run build && cd src-tauri && cargo test web_bundle
```

`src-tauri/src/web_bundle.rs`:

- `a_confirmed_bundle_launches_unchanged`
- `the_first_launch_of_an_installed_bundle_starts_its_trial`
- `a_launch_that_finds_the_trial_still_pending_rolls_back_and_blocks_the_version`
- `a_failed_first_bundle_rolls_back_to_the_embedded_bundle`
- `staging_over_an_unconfirmed_bundle_keeps_the_last_confirmed_one_as_previous`
- `confirming_ends_the_trial_and_hands_over_the_rollback_once`
- `serves_the_active_bundle_and_starts_its_trial`
- `rolls_back_to_the_embedded_bundle_when_the_trial_never_confirmed`
- `the_launch_after_a_rollback_reports_it_when_the_frontend_is_ready`
- `keeps_the_embedded_bundle_when_the_active_folder_has_no_index`
- `refuses_to_install_a_blocked_active_or_unstable_version`
- `refuses_to_install_a_bundle_that_does_not_verify`
- `unpacks_and_stages_a_verified_bundle_on_trial`
- `removes_bundles_that_are_neither_active_nor_previous`
- `refuses_keys_that_leave_the_bundle`

`src-tauri/src/web_bundle_install.rs`:

- `accepts_a_bundle_with_its_sha256_and_signature`
- `refuses_a_bundle_that_does_not_match_its_sha256`
- `refuses_a_bundle_whose_signature_does_not_verify`
- `unpacks_a_bundle_into_its_folder`
- `refuses_entries_that_leave_the_bundle`
- `refuses_a_link_entry`
- `refuses_a_bundle_without_index_html`

## Manual proof on macOS and Windows

Not done yet. It needs a card reader, a tachograph card and a real login.

Set up:

1. Build a release with `npm run tauri build`, or use the installed app built from
   this branch.
2. Copy a `dist/spa` into the bundles folder as version `9.9.9`, and mark it active:
   - macOS: `~/Library/Application Support/com.transportklok.tcc/web-bundles/9.9.9/`
   - Windows: `%APPDATA%\com.transportklok.tcc\web-bundles\9.9.9\`
   - Next to it, `state.json`: `{"active": "9.9.9", "previous": null, "trial": null, "blocked": [], "rolled_back": null}`
3. Add a visible marker to the copied `index.html`, for example
   `<div style="position:fixed;bottom:0;right:0">downloaded</div>` before `</body>`.

Do each round below twice: once with that state in place (round A), and once with
`state.json` removed (round B, the fallback).

1. The app opens on the launch screen. Round A shows the marker. Round B does not.
2. Log in. Then quit the app and start it again. You are still logged in, so the
   local storage tokens survived.
3. Logged in during round B, switch to round A and restart. You are still logged in,
   so the downloaded bundle reads the same local storage.
4. Insert the tachograph card. It appears in the card list (the `update_card` event
   and invoke).
5. Run a manual sync of the cards (`manual_sync_cards`). Remove a card
   (`remove_card`).
6. The MQTT connection comes up (`app_connection`): the connection status is green,
   and the log shows a connection to the broker.
7. Change the server settings (`update_server`). The app reconnects.
8. Windows only: the window appears and loads without a blank screen. Tauri waits
   300 ms on Windows before it starts its work after the frontend loads.
9. The CSP: with the developer console open, no `Content-Security-Policy` violations
   appear during login, the card list and the server settings.

Rollback:

1. Set `"trial": "launched"` in `state.json` and start the app. It opens without the
   marker, on the built-in bundle, and `state.json` now lists `9.9.9` under `blocked`
   and `rolled_back`.
2. Set `"trial": "installed"` and start the app. It shows the marker, and after the
   launch screen, `state.json` has `"trial": null`, because the frontend confirmed it.
