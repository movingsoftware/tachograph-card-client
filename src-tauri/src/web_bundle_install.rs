//! Verifies a downloaded web bundle zip and unpacks it into a bundle folder.

use std::fs;
use std::io::{self, Cursor, Read};
use std::path::Path;

use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use sha2::{Digest, Sha256};
use zip::ZipArchive;

/// Largest web bundle zip that is downloaded.
pub const MAX_ZIP_BYTES: u64 = 64 * 1024 * 1024;

/// Largest total size of the unpacked files.
const MAX_UNPACKED_BYTES: u64 = 256 * 1024 * 1024;

/// Largest number of entries in one bundle zip.
const MAX_ENTRIES: usize = 10_000;

/// Check the zip against its sha256 and its minisign signature, both as Platform publishes them.
///
/// `signature` and `public_key` are base64 minisign documents, as the Tauri updater uses them.
pub fn verify(zip: &[u8], sha256_hex: &str, signature: &str, public_key: &str) -> Result<(), String> {
    let digest = Sha256::digest(zip);
    if !hex::encode(digest).eq_ignore_ascii_case(sha256_hex) {
        return Err("the bundle does not match its sha256".into());
    }

    let public_key = PublicKey::decode(&base64_text(public_key)?).map_err(|e| format!("the signing key is invalid: {e}"))?;
    let signature = Signature::decode(&base64_text(signature)?).map_err(|e| format!("the signature is invalid: {e}"))?;
    public_key
        .verify(zip, &signature, true)
        .map_err(|e| format!("the bundle signature does not verify: {e}"))
}

/// Unpack the zip into `into`, refusing entries that leave it, links, and bundles without an `index.html`.
pub fn unpack(zip: &[u8], into: &Path) -> Result<(), String> {
    let mut archive = ZipArchive::new(Cursor::new(zip)).map_err(|e| format!("the bundle is not a zip: {e}"))?;
    if archive.len() > MAX_ENTRIES {
        return Err("the bundle has too many files".into());
    }
    if into.exists() {
        fs::remove_dir_all(into).map_err(io_error)?;
    }
    fs::create_dir_all(into).map_err(io_error)?;

    let mut remaining = MAX_UNPACKED_BYTES;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| format!("the bundle zip is damaged: {e}"))?;
        let Some(relative) = entry.enclosed_name() else {
            return Err(format!("the bundle entry {} leaves the bundle", entry.name()));
        };
        if entry.is_symlink() {
            return Err(format!("the bundle entry {} is a link", entry.name()));
        }
        let path = into.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(io_error)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io_error)?;
        }
        let mut file = fs::File::create(&path).map_err(io_error)?;
        let written = io::copy(&mut (&mut entry).take(remaining + 1), &mut file).map_err(io_error)?;
        if written > remaining {
            return Err("the unpacked bundle is too large".into());
        }
        remaining -= written;
    }

    if !into.join("index.html").is_file() {
        return Err("the bundle has no index.html".into());
    }
    Ok(())
}

/// Decode a base64 minisign document into its text.
fn base64_text(value: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|e| format!("a minisign document is not base64: {e}"))?;
    String::from_utf8(bytes).map_err(|_| "a minisign document is not text".into())
}

/// Describe a file system error.
fn io_error(error: io::Error) -> String {
    format!("the bundle could not be written: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    /// The public key of minisign-verify's own test vector, as a base64 key file.
    fn public_key() -> String {
        let file = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
        base64::engine::general_purpose::STANDARD.encode(file)
    }

    /// minisign-verify's signature of the bytes `test`, as a base64 document.
    fn signature() -> String {
        let file = "untrusted comment: signature from minisign secret key\nRWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\ntrusted comment: timestamp:1555779966\tfile:test\nQtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==";
        base64::engine::general_purpose::STANDARD.encode(file)
    }

    /// A fresh folder for one test.
    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tcc-web-bundle-install-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    /// Build a zip with the given entries.
    fn zip_with(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, content) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn accepts_a_bundle_with_its_sha256_and_signature() {
        let sha256 = hex::encode(Sha256::digest(b"test"));

        assert_eq!(verify(b"test", &sha256, &signature(), &public_key()), Ok(()));
    }

    #[test]
    fn refuses_a_bundle_that_does_not_match_its_sha256() {
        let sha256 = hex::encode(Sha256::digest(b"other"));

        assert!(verify(b"test", &sha256, &signature(), &public_key()).unwrap_err().contains("sha256"));
    }

    #[test]
    fn refuses_a_bundle_whose_signature_does_not_verify() {
        let sha256 = hex::encode(Sha256::digest(b"tampered"));

        assert!(verify(b"tampered", &sha256, &signature(), &public_key()).unwrap_err().contains("signature"));
    }

    #[test]
    fn unpacks_a_bundle_into_its_folder() {
        let into = folder("unpack");
        let zip = zip_with(&[("index.html", "<html></html>"), ("assets/app.js", "app")]);

        assert_eq!(unpack(&zip, &into), Ok(()));
        assert_eq!(fs::read_to_string(into.join("assets/app.js")).unwrap(), "app");
    }

    #[test]
    fn refuses_entries_that_leave_the_bundle() {
        for name in ["../escape.js", "/etc/escape.js", "assets/../../escape.js"] {
            let into = folder("traversal");
            let zip = zip_with(&[("index.html", "<html></html>"), (name, "escape")]);

            assert!(unpack(&zip, &into).unwrap_err().contains("leaves the bundle"), "{name}");
            assert!(!into.parent().unwrap().join("escape.js").exists());
        }
    }

    #[test]
    fn refuses_a_link_entry() {
        let into = folder("link");
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("index.html", SimpleFileOptions::default()).unwrap();
        writer.write_all(b"<html></html>").unwrap();
        writer.add_symlink("assets", "/etc", SimpleFileOptions::default()).unwrap();
        let zip = writer.finish().unwrap().into_inner();

        assert!(unpack(&zip, &into).unwrap_err().contains("is a link"));
    }

    #[test]
    fn refuses_a_bundle_without_index_html() {
        let into = folder("no-index");
        let zip = zip_with(&[("assets/app.js", "app")]);

        assert!(unpack(&zip, &into).unwrap_err().contains("index.html"));
    }
}
