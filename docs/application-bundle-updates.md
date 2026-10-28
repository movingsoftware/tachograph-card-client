# Application bundle updates

The desktop client checks the public application-bundle API before starting route
flow. If a newer updater bundle is available, it downloads that exact release
through the Tauri updater plugin, verifies the native minisign signature, installs
the held update, and asks Tauri to relaunch. Route flow, card monitoring, MQTT,
and the frontend-loaded event do not start until that startup check finishes.

During normal use, the client checks again when the app becomes visible, as
described under the launch gate below, and never installs while a card is
authenticating. Both updaters are `createLiveBundleUpdater` from shared.js.

Development and ordinary frontend builds leave the updater disabled. A release
build uses `npm run build:release` and requires all of these environment values:

- `BUNDLE_UPDATER_API_BASE_URL`: public HTTPS API origin.
- `BUNDLE_UPDATER_APPLICATION_ID`: explicit application UUID.
- `BUNDLE_UPDATER_SIGNING_KEY_ID`: key identifier that must match release metadata.
- `BUNDLE_UPDATER_PUBLIC_KEY`: minisign public key compiled into the native app.
- `BUNDLE_APP_VERSION`: stable semantic version equal to package.json, Tauri, and
  Cargo source versions.

The preparation script uses those same values for the native updater endpoint and
frontend configuration. It writes the generated Tauri configuration to a private
temporary file and removes it after the build. It never stores a private signing
key or inserts a placeholder key. Set the three source versions together for a
release and keep Cargo.lock/package-lock in sync. The release version must exceed
the versions actually deployed to users; the source version `0.7.0` is only the
current repository baseline, not a claim about a deployed build.

The endpoint template requests `format=tauri`, the native `{{target}}-{{arch}}`,
and `{{current_version}}`. The native adapter also compares the Tauri check
result's version, URL, signature, installed version, and configured key ID with
the public candidate before it downloads. The key ID is metadata binding; native
trust comes from the public key compiled into the application.

A metadata or network failure during startup lets the existing app continue. An
install or relaunch failure blocks route flow and displays recovery guidance,
because continuing after a partially applied update could start work against an
uncertain executable. The browser development adapter uses the explicitly injected
build version and does not register native updater behavior.

## Launch gate and web bundles

The launch route flow starts with a `check-bundle-update` step, before the user gets
to log in. It checks the native bundle first, then the web bundle. Either one that is
newer is downloaded, installed and applied by relaunching before the flow continues.
A failed install keeps the launch screen and offers a restart. The check runs once
per app start; a launch flow that restarts later (offline, maintenance, logout)
reuses the result.

Web bundles come from `/bundles/web/latest`. The client sends the installation id,
the native version and the channel (`stable` unless Platform overrides it for this
installation). Any other version, older or newer, is available, because a channel
can roll a web bundle back. The native side downloads the zip, verifies it and
stages it (`install_web_bundle`). The relaunch then serves it.

When the app becomes visible again, it checks native and web bundles at most once
every 15 minutes. It downloads and applies an update only while no card is
authenticating, which the native side reports with every `global-cards-sync` event.
An update downloaded while a card became busy is applied at the next resume check or start. Card
monitoring and MQTT start only after the frontend loads, which is after the launch gate.

The installation id is a random UUID kept in local storage
(`transportklok_installation_id`), so it survives web bundle updates. It is sent as
`installation_id` with device registration.
