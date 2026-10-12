# Application bundle updates

The desktop client checks the public application-bundle API before starting route
flow. If a newer updater bundle is available, it downloads that exact release
through the Tauri updater plugin, verifies the native minisign signature, installs
the held update, and asks Tauri to relaunch. Route flow, card monitoring, MQTT,
and the frontend-loaded event do not start until that startup check finishes.

During normal use, the client checks release metadata every six hours with small
jitter. It only reports that an update will be installed at the next restart; it
does not download or install while card or MQTT work may be active. The app has no
native idle/drain contract, so in-session installation is intentionally deferred
until one exists. Manual release discovery is available through the updater
service's `checkManually()` method and performs a metadata check only.

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
