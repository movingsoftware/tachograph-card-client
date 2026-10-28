//! Serves the frontend from an installed web bundle in app data, with the embedded bundle as fallback,
//! and rolls back a bundle whose launch never confirmed it.

use std::borrow::Cow;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{AppHandle, Assets, Context, Runtime};

use crate::web_bundle_install::{self, MAX_ZIP_BYTES};

/// Folder under the app data directory that holds the installed bundles and their state.
const BUNDLES_DIR: &str = "web-bundles";

/// File in the bundles folder that records which bundle runs.
const STATE_FILE: &str = "state.json";

/// Serializes every read and write of the bundle state.
static STATE_LOCK: Mutex<()> = Mutex::new(());

/// How far an installed bundle that has not confirmed itself got.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Trial {
    Installed,
    Launched,
}

/// Which installed bundle runs, the one before it, and what was rolled back.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct BundleState {
    /// Version served at launch; none serves the embedded bundle.
    pub active: Option<String>,
    /// Last confirmed version, served again when the active one fails its trial.
    pub previous: Option<String>,
    /// Set while the active version has not called `bundle_ready`.
    pub trial: Option<Trial>,
    /// Versions that failed their trial and are never installed again.
    pub blocked: Vec<String>,
    /// Version rolled back at a failed launch, until `bundle_ready` hands it to the frontend to report.
    pub rolled_back: Option<String>,
}

impl BundleState {
    /// Read the state, or start empty when it is missing or unreadable.
    fn load(root: &Path) -> Self {
        fs::read(root.join(STATE_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    /// Write the state through a temporary file, so a crash never leaves half a state.
    fn save(&self, root: &Path) -> Result<(), String> {
        let json = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        let temporary = root.join(format!("{STATE_FILE}.tmp"));
        fs::create_dir_all(root)
            .and_then(|_| fs::write(&temporary, json))
            .and_then(|_| fs::rename(&temporary, root.join(STATE_FILE)))
            .map_err(|e| format!("the bundle state could not be saved: {e}"))
    }

    /// Start a launch: roll back a bundle whose last launch never confirmed it, and return the version to serve.
    fn launch(&mut self) -> Option<String> {
        match self.trial {
            Some(Trial::Launched) => {
                let failed = self.active.take();
                if let Some(version) = &failed {
                    self.blocked.push(version.clone());
                }
                self.active = self.previous.take();
                self.trial = None;
                self.rolled_back = failed;
            }
            Some(Trial::Installed) => self.trial = Some(Trial::Launched),
            None => {}
        }
        self.active.clone()
    }

    /// Make a freshly unpacked version active for the next launch, on trial.
    fn stage(&mut self, version: &str) {
        if self.trial.is_none() {
            self.previous = self.active.take();
        }
        self.active = Some(version.to_string());
        self.trial = Some(Trial::Installed);
        self.rolled_back = None;
    }

    /// End the running bundle's trial and hand over a rollback not yet reported.
    fn confirm(&mut self) -> Option<String> {
        self.trial = None;
        self.rolled_back.take()
    }
}

/// An installed `dist/spa` served from disk.
struct DownloadedBundle {
    root: PathBuf,
}

impl<R: Runtime> Assets<R> for DownloadedBundle {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        read_asset(&self.root, key).map(Cow::Owned)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        let mut files = Vec::new();
        collect_files(&self.root, &self.root, &mut files);
        Box::new(files.into_iter())
    }

    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        // A Vite build has no inline scripts, so the CSP needs no hashes for it.
        Box::new(std::iter::empty())
    }
}

/// Serve the active installed bundle, rolling back one that failed its trial; otherwise keep the embedded bundle.
pub fn serve<R: Runtime>(context: &mut Context<R>) {
    if let Some(root) = bundles_dir(&context.config().identifier) {
        serve_from(context, &root);
    }
}

/// Serve the active bundle under the bundles folder `root`.
fn serve_from<R: Runtime>(context: &mut Context<R>, root: &Path) {
    let _lock = lock();
    let mut state = BundleState::load(root);
    let before = state.clone();
    let active = state.launch();
    if state != before {
        if let Err(error) = state.save(root) {
            println!("Web bundle: {error}");
        }
    }
    if let (Some(version), true) = (&state.rolled_back, state.rolled_back != before.rolled_back) {
        println!("Web bundle: rolled back {version}, which never confirmed its launch");
    }

    match active.map(|version| root.join(version)).filter(|dir| dir.join("index.html").is_file()) {
        Some(dir) => {
            println!("Web bundle: installed ({})", dir.display());
            context.set_assets(Box::new(DownloadedBundle { root: dir }));
        }
        None => println!("Web bundle: embedded"),
    }
}

/// Download, verify and unpack a signed web bundle, to run on trial from the next launch.
#[tauri::command]
pub async fn install_web_bundle(
    app: AppHandle,
    url: String,
    version: String,
    sha256: String,
    signature: String,
) -> Result<(), String> {
    let root = bundles_dir(&app.config().identifier).ok_or("the app data folder is unknown")?;
    let public_key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|key| key.as_str())
        .ok_or("this build has no signing key")?
        .to_string();
    let zip = download(&url).await?;
    install_downloaded(&root, &version, &zip, &sha256, &signature, &public_key)
}

/// Confirm that the running bundle started, and return the version rolled back at this launch, once.
#[tauri::command]
pub fn bundle_ready(app: AppHandle) -> Result<Option<String>, String> {
    let root = bundles_dir(&app.config().identifier).ok_or("the app data folder is unknown")?;
    confirm_in(&root)
}

/// Confirm the running bundle under the bundles folder `root`.
fn confirm_in(root: &Path) -> Result<Option<String>, String> {
    let _lock = lock();
    let mut state = BundleState::load(root);
    let before = state.clone();
    let rolled_back = state.confirm();
    if state != before {
        state.save(root)?;
    }
    Ok(rolled_back)
}

/// Report the installed bundles and any rollback.
#[tauri::command]
pub fn web_bundle_status(app: AppHandle) -> Result<BundleState, String> {
    let root = bundles_dir(&app.config().identifier).ok_or("the app data folder is unknown")?;
    let _lock = lock();
    Ok(BundleState::load(&root))
}

/// Verify and unpack a downloaded zip as `version`, then stage it and remove bundles no longer needed.
fn install_downloaded(
    root: &Path,
    version: &str,
    zip: &[u8],
    sha256: &str,
    signature: &str,
    public_key: &str,
) -> Result<(), String> {
    if !is_stable_version(version) {
        return Err(format!("{version} is not a stable version"));
    }
    let _lock = lock();
    let mut state = BundleState::load(root);
    if state.blocked.iter().any(|blocked| blocked == version) {
        return Err(format!("{version} failed to start before and is blocked"));
    }
    if state.active.as_deref() == Some(version) {
        return Err(format!("{version} is already installed"));
    }
    web_bundle_install::verify(zip, sha256, signature, public_key)?;
    unpack_and_stage(root, &mut state, version, zip)
}

/// Unpack a verified zip as `version`, stage it, and remove bundles no longer needed.
fn unpack_and_stage(root: &Path, state: &mut BundleState, version: &str, zip: &[u8]) -> Result<(), String> {
    let staging = root.join(".staging");
    web_bundle_install::unpack(zip, &staging)?;
    let target = root.join(version);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    fs::rename(&staging, &target).map_err(|e| e.to_string())?;

    state.stage(version);
    state.save(root)?;
    remove_unused_bundles(root, state);
    Ok(())
}

/// Download a bundle zip over HTTPS within the size limit.
async fn download(url: &str) -> Result<Vec<u8>, String> {
    if !url.starts_with("https://") {
        return Err("bundles are downloaded over HTTPS only".into());
    }
    let response = reqwest::get(url)
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|e| format!("the bundle could not be downloaded: {e}"))?;
    if response.content_length().is_some_and(|length| length > MAX_ZIP_BYTES) {
        return Err("the bundle is too large".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("the bundle could not be downloaded: {e}"))?;
    if bytes.len() as u64 > MAX_ZIP_BYTES {
        return Err("the bundle is too large".into());
    }
    Ok(bytes.to_vec())
}

/// Remove every bundle folder that is neither active nor previous.
fn remove_unused_bundles(root: &Path, state: &BundleState) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for path in entries.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()) {
        let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
        if state.active.as_deref() != Some(name) && state.previous.as_deref() != Some(name) {
            let _ = fs::remove_dir_all(&path);
        }
    }
}

/// The bundles folder, resolved the way Tauri resolves `app_data_dir`.
fn bundles_dir(identifier: &str) -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(identifier).join(BUNDLES_DIR))
}

/// Whether `version` is a stable `x.y.z` version, safe to use as a folder name.
fn is_stable_version(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.len() <= 10
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && (part.len() == 1 || !part.starts_with('0'))
        })
}

/// Take the bundle state lock, even after a panic in another holder.
fn lock() -> MutexGuard<'static, ()> {
    STATE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Read the file for `key` inside `root`, refusing any key that leaves it.
fn read_asset(root: &Path, key: &AssetKey) -> Option<Vec<u8>> {
    let relative = Path::new(key.as_ref().trim_start_matches('/'));
    if !relative
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
    {
        return None;
    }
    fs::read(root.join(relative)).ok()
}

/// Collect every file below `dir` as an asset key and its content.
fn collect_files(
    root: &Path,
    dir: &Path,
    files: &mut Vec<(Cow<'static, str>, Cow<'static, [u8]>)>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for path in entries.flatten().map(|entry| entry.path()) {
        if path.is_dir() {
            collect_files(root, &path, files);
        } else if let (Ok(relative), Ok(content)) = (path.strip_prefix(root), fs::read(&path)) {
            let key = AssetKey::from(relative);
            files.push((Cow::Owned(key.into()), Cow::Owned(content)));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use tauri::test::{mock_context, MockRuntime};

    /// The `index.html` of the stand-in embedded bundle.
    const EMBEDDED_INDEX: &[u8] = b"<html>embedded</html>";

    /// Stands in for the bundle Tauri embeds, since only lib.rs may expand `generate_context!`.
    struct EmbeddedBundle;

    impl Assets<MockRuntime> for EmbeddedBundle {
        fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
            (key.as_ref() == "/index.html").then_some(Cow::Borrowed(EMBEDDED_INDEX))
        }

        fn iter(&self) -> Box<AssetsIter<'_>> {
            Box::new(std::iter::empty())
        }

        fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
            Box::new(std::iter::empty())
        }
    }

    /// A context whose assets are the stand-in embedded bundle.
    fn embedded_context() -> Context<MockRuntime> {
        mock_context(EmbeddedBundle)
    }

    /// A fresh bundles folder for one test.
    fn bundles(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tcc-web-bundle-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Write an installed bundle file.
    fn write_bundle_file(root: &Path, version: &str, relative: &str, content: &str) {
        let path = root.join(version).join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    /// A state with the given versions and trial.
    fn state(active: Option<&str>, previous: Option<&str>, trial: Option<Trial>) -> BundleState {
        BundleState {
            active: active.map(str::to_string),
            previous: previous.map(str::to_string),
            trial,
            ..BundleState::default()
        }
    }

    #[test]
    fn a_confirmed_bundle_launches_unchanged() {
        let mut launched = state(Some("2.0.0"), Some("1.0.0"), None);

        assert_eq!(launched.launch().as_deref(), Some("2.0.0"));
        assert_eq!(launched, state(Some("2.0.0"), Some("1.0.0"), None));
    }

    #[test]
    fn the_first_launch_of_an_installed_bundle_starts_its_trial() {
        let mut launched = state(Some("2.0.0"), Some("1.0.0"), Some(Trial::Installed));

        assert_eq!(launched.launch().as_deref(), Some("2.0.0"));
        assert_eq!(launched.trial, Some(Trial::Launched));
    }

    #[test]
    fn a_launch_that_finds_the_trial_still_pending_rolls_back_and_blocks_the_version() {
        let mut launched = state(Some("2.0.0"), Some("1.0.0"), Some(Trial::Launched));

        assert_eq!(launched.launch().as_deref(), Some("1.0.0"));
        assert_eq!(launched.active.as_deref(), Some("1.0.0"));
        assert_eq!(launched.previous, None);
        assert_eq!(launched.trial, None);
        assert_eq!(launched.blocked, vec!["2.0.0".to_string()]);
        assert_eq!(launched.rolled_back.as_deref(), Some("2.0.0"));
    }

    #[test]
    fn a_failed_first_bundle_rolls_back_to_the_embedded_bundle() {
        let mut launched = state(Some("2.0.0"), None, Some(Trial::Launched));

        assert_eq!(launched.launch(), None);
        assert_eq!(launched.blocked, vec!["2.0.0".to_string()]);
    }

    #[test]
    fn staging_over_an_unconfirmed_bundle_keeps_the_last_confirmed_one_as_previous() {
        let mut staged = state(Some("2.0.0"), Some("1.0.0"), Some(Trial::Launched));

        staged.stage("2.1.0");

        assert_eq!(staged, state(Some("2.1.0"), Some("1.0.0"), Some(Trial::Installed)));
    }

    #[test]
    fn confirming_ends_the_trial_and_hands_over_the_rollback_once() {
        let mut confirmed = BundleState {
            rolled_back: Some("2.0.0".to_string()),
            ..state(Some("1.0.0"), None, Some(Trial::Launched))
        };

        assert_eq!(confirmed.confirm().as_deref(), Some("2.0.0"));
        assert_eq!(confirmed, state(Some("1.0.0"), None, None));
        assert_eq!(confirmed.confirm(), None);
    }

    #[test]
    fn the_launch_after_a_rollback_reports_it_when_the_frontend_is_ready() {
        let mut context = embedded_context();
        let root = bundles("report");
        write_bundle_file(&root, "1.0.0", "index.html", "<html>previous</html>");
        write_bundle_file(&root, "2.0.0", "index.html", "<html>broken</html>");
        state(Some("2.0.0"), Some("1.0.0"), Some(Trial::Launched)).save(&root).unwrap();

        serve_from(&mut context, &root);

        assert_eq!(context.assets().get(&"index.html".into()).as_deref(), Some(&b"<html>previous</html>"[..]));
        assert_eq!(confirm_in(&root), Ok(Some("2.0.0".to_string())));
        assert_eq!(confirm_in(&root), Ok(None));
        let saved = BundleState::load(&root);
        assert_eq!(saved.active.as_deref(), Some("1.0.0"));
        assert_eq!(saved.blocked, vec!["2.0.0".to_string()]);
        assert_eq!(saved.trial, None);
    }

    #[test]
    fn serves_the_active_bundle_and_starts_its_trial() {
        let mut context = embedded_context();
        let root = bundles("serve");
        write_bundle_file(&root, "2.0.0", "index.html", "<html>installed</html>");
        write_bundle_file(&root, "2.0.0", "assets/app.js", "app");
        state(Some("2.0.0"), None, Some(Trial::Installed)).save(&root).unwrap();

        serve_from(&mut context, &root);

        let assets = context.assets();
        assert_eq!(assets.get(&"index.html".into()).as_deref(), Some(&b"<html>installed</html>"[..]));
        assert_eq!(assets.get(&"/assets/app.js".into()).as_deref(), Some(&b"app"[..]));
        assert!(assets.get(&"assets/missing.js".into()).is_none());
        assert_eq!(assets.iter().count(), 2);
        assert_eq!(BundleState::load(&root).trial, Some(Trial::Launched));
    }

    #[test]
    fn rolls_back_to_the_embedded_bundle_when_the_trial_never_confirmed() {
        let mut context = embedded_context();
        let root = bundles("rollback");
        write_bundle_file(&root, "2.0.0", "index.html", "<html>broken</html>");
        state(Some("2.0.0"), None, Some(Trial::Launched)).save(&root).unwrap();

        serve_from(&mut context, &root);

        assert_eq!(context.assets().get(&"index.html".into()).as_deref(), Some(EMBEDDED_INDEX));
        let saved = BundleState::load(&root);
        assert_eq!(saved.blocked, vec!["2.0.0".to_string()]);
        assert_eq!(saved.rolled_back.as_deref(), Some("2.0.0"));
    }

    #[test]
    fn keeps_the_embedded_bundle_when_the_active_folder_has_no_index() {
        let mut context = embedded_context();
        let root = bundles("no-index");
        write_bundle_file(&root, "2.0.0", "assets/app.js", "app");
        state(Some("2.0.0"), None, None).save(&root).unwrap();

        serve_from(&mut context, &root);

        assert_eq!(context.assets().get(&"index.html".into()).as_deref(), Some(EMBEDDED_INDEX));
    }

    #[test]
    fn refuses_to_install_a_blocked_active_or_unstable_version() {
        let root = bundles("install-refused");
        BundleState { active: Some("3.0.0".to_string()), blocked: vec!["2.0.0".to_string()], ..BundleState::default() }
            .save(&root)
            .unwrap();

        assert!(install_downloaded(&root, "2.0.0", b"", "", "", "").unwrap_err().contains("blocked"));
        assert!(install_downloaded(&root, "3.0.0", b"", "", "", "").unwrap_err().contains("already installed"));
        assert!(install_downloaded(&root, "../2.0.0", b"", "", "", "").unwrap_err().contains("stable version"));
        assert!(install_downloaded(&root, "02.0.0", b"", "", "", "").unwrap_err().contains("stable version"));
        assert!(!is_stable_version("2.0"));
        assert!(is_stable_version("10.0.1"));
    }

    #[test]
    fn refuses_to_install_a_bundle_that_does_not_verify() {
        let root = bundles("install-unverified");

        assert!(install_downloaded(&root, "2.0.0", b"zip", "00", "", "").unwrap_err().contains("sha256"));
        assert_eq!(BundleState::load(&root), BundleState::default());
        assert!(!root.join("2.0.0").exists());
    }

    #[test]
    fn unpacks_and_stages_a_verified_bundle_on_trial() {
        use std::io::{Cursor, Write};
        let root = bundles("install");
        write_bundle_file(&root, "1.0.0", "index.html", "old");
        write_bundle_file(&root, "0.9.0", "index.html", "older");
        let mut current = state(Some("1.0.0"), Some("0.9.0"), None);
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("index.html", zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(b"<html>new</html>").unwrap();
        let zip = writer.finish().unwrap().into_inner();

        unpack_and_stage(&root, &mut current, "2.0.0", &zip).unwrap();

        assert_eq!(fs::read_to_string(root.join("2.0.0/index.html")).unwrap(), "<html>new</html>");
        assert_eq!(BundleState::load(&root), state(Some("2.0.0"), Some("1.0.0"), Some(Trial::Installed)));
        assert!(root.join("1.0.0").exists());
        assert!(!root.join("0.9.0").exists());
        assert!(!root.join(".staging").exists());
    }

    #[test]
    fn removes_bundles_that_are_neither_active_nor_previous() {
        let root = bundles("prune");
        for version in ["1.0.0", "2.0.0", "3.0.0"] {
            write_bundle_file(&root, version, "index.html", version);
        }

        remove_unused_bundles(&root, &state(Some("3.0.0"), Some("2.0.0"), Some(Trial::Installed)));

        assert!(!root.join("1.0.0").exists());
        assert!(root.join("2.0.0").exists());
        assert!(root.join("3.0.0").exists());
    }

    #[test]
    fn refuses_keys_that_leave_the_bundle() {
        let dir = bundles("traversal");
        let root = dir.join("bundle");
        fs::create_dir_all(&root).unwrap();
        fs::write(dir.join("secret.txt"), "secret").unwrap();
        fs::write(root.join("index.html"), "index").unwrap();

        assert_eq!(read_asset(&root, &"index.html".into()), Some(b"index".to_vec()));
        assert!(read_asset(&root, &"../secret.txt".into()).is_none());
        assert!(read_asset(&root, &"/assets/../../secret.txt".into()).is_none());
    }
}
