//! Owner-private local state under `BATUTA_HOME` or `~/.batuta`.

use crate::sha256::{hex, sha256};
use crate::storage;
use std::fs;
use std::path::{Path, PathBuf};

pub fn app_dir() -> PathBuf {
    if let Ok(path) = std::env::var("BATUTA_HOME") {
        return PathBuf::from(path);
    }
    // v0.x compatibility for installations created before the English rename.
    if let Ok(path) = std::env::var("BATUTA_CASA") {
        return PathBuf::from(path);
    }
    user_home().join(".batuta")
}

pub fn user_home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

pub fn ensure() -> std::io::Result<PathBuf> {
    let directory = app_dir();
    storage::ensure_private_dir(&directory)?;
    Ok(directory)
}

/// Compatibility helper for the original infallible API.
pub fn ensure_dir() -> PathBuf {
    ensure().unwrap_or_else(|_| app_dir())
}

// ------------------------------------------------------------------------ salt

/// Returns the local salt or fails closed if the OS has no secure random source.
pub fn try_salt() -> std::io::Result<String> {
    let file = ensure()?.join("salt");
    if let Ok(value) = fs::read_to_string(&file) {
        let value = value.trim().to_string();
        if value.len() >= 32 {
            storage::restrict_file(&file, 0o600)?;
            return Ok(value);
        }
    }
    let generated = generate_salt()?;
    storage::atomic_write(&file, generated.as_bytes(), 0o600)?;
    Ok(generated)
}

/// Compatibility wrapper. Canonical hot-path code uses `try_salt` and stays silent
/// on failure rather than manufacturing predictable entropy.
pub fn salt() -> String {
    try_salt().unwrap_or_else(|error| panic!("batuta: cannot create a secure local salt: {error}"))
}

fn generate_salt() -> std::io::Result<String> {
    // `/dev/urandom` has no end; always read a fixed-size buffer.
    if let Ok(mut file) = fs::File::open("/dev/urandom") {
        use std::io::Read;
        let mut bytes = [0_u8; 32];
        if file.read_exact(&mut bytes).is_ok() {
            return Ok(hex(&sha256(&bytes)));
        }
    }

    #[cfg(windows)]
    {
        #[link(name = "bcrypt")]
        extern "system" {
            fn BCryptGenRandom(
                algorithm: *mut std::ffi::c_void,
                buffer: *mut u8,
                length: u32,
                flags: u32,
            ) -> i32;
        }
        const BCRYPT_USE_SYSTEM_PREFERRED_RNG: u32 = 0x2;
        let mut bytes = [0_u8; 32];
        // SAFETY: the OS fills exactly `bytes.len()` bytes in a live buffer.
        let status = unsafe {
            BCryptGenRandom(
                std::ptr::null_mut(),
                bytes.as_mut_ptr(),
                bytes.len() as u32,
                BCRYPT_USE_SYSTEM_PREFERRED_RNG,
            )
        };
        if status == 0 {
            return Ok(hex(&sha256(&bytes)));
        }
    }

    Err(std::io::Error::other(
        "operating system secure random source is unavailable",
    ))
}

pub fn installation_id() -> String {
    let salt = salt();
    // Keep the v0 derivation literal so upgrades retain their installation ID.
    hex(&sha256(format!("instalacao|{salt}").as_bytes()))[..16].to_string()
}

// --------------------------------------------------------------------- config

#[derive(Debug, Clone)]
pub struct Config {
    pub upload: bool,
    pub holdout_pct: u32,
    pub portal: String,
    pub informed: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            upload: false,
            holdout_pct: 5,
            portal: "https://batuta.space".to_string(),
            informed: false,
        }
    }
}

pub fn read_config() -> Config {
    let mut config = Config::default();
    let Ok(contents) = fs::read_to_string(app_dir().join("config.txt")) else {
        return config;
    };
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "upload" | "envio" => config.upload = matches!(value, "yes" | "sim" | "true" | "1"),
            "holdout_pct" => config.holdout_pct = value.parse().unwrap_or(5).min(50),
            "portal" => config.portal = value.to_string(),
            "informed" | "warned" | "avisado" => {
                config.informed = matches!(value, "yes" | "sim" | "true" | "1")
            }
            _ => {}
        }
    }
    config
}

pub fn write_config(config: &Config) -> std::io::Result<()> {
    let file = ensure()?.join("config.txt");
    let body = format!(
        "# Batuta config — nothing is uploaded while upload=no\n\
         upload={}\n\
         holdout_pct={}\n\
         portal={}\n\
         informed={}\n",
        if config.upload { "yes" } else { "no" },
        config.holdout_pct,
        config.portal,
        if config.informed { "yes" } else { "no" }
    );
    storage::atomic_write(&file, body.as_bytes(), 0o600)
}

pub fn atomic_write(path: &Path, bytes: &[u8], mode: u32) -> std::io::Result<()> {
    storage::atomic_write(path, bytes, mode)
}
