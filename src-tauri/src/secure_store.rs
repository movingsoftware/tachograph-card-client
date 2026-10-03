// Device and session bearers kept in the operating system's credential store.
use keyring::{Entry, Error};

const SERVICE: &str = "com.transportklok.tcc";

fn entry(key: &str) -> Result<Entry, String> {
    if key.is_empty() {
        return Err("A secure store key is required.".into());
    }

    Entry::new(SERVICE, key).map_err(|error| error.to_string())
}

/// Reads a stored secret, or nothing when the key was never stored.
#[tauri::command]
pub fn secure_store_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// Stores a secret, replacing any earlier value.
#[tauri::command]
pub fn secure_store_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

/// Removes a secret; removing an absent key succeeds.
#[tauri::command]
pub fn secure_store_remove(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
