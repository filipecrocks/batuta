//! Owner-private local state under `BATUTA_HOME` or `~/.batuta`.

use crate::sha256::{hex, sha256};
use crate::storage;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

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
    validate_state_directory(&directory)?;
    storage::ensure_private_dir(&directory)?;
    Ok(directory)
}

fn validate_state_directory(directory: &Path) -> std::io::Result<()> {
    use std::io::{Error, ErrorKind};
    if directory.as_os_str().is_empty()
        || directory == Path::new(".")
        || directory
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            "BATUTA_HOME must name a dedicated directory",
        ));
    }
    let absolute = if directory.is_absolute() {
        directory.to_path_buf()
    } else {
        std::env::current_dir()?.join(directory)
    };
    let resolved = absolute.canonicalize().unwrap_or(absolute);
    let dangerous = [
        std::env::current_dir().ok(),
        user_home().canonicalize().ok(),
        std::env::temp_dir().canonicalize().ok(),
    ];
    if resolved.parent().is_none() || dangerous.into_iter().flatten().any(|path| path == resolved) {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            "refusing a shared or top-level BATUTA_HOME",
        ));
    }
    if let Ok(metadata) = fs::symlink_metadata(directory) {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                "BATUTA_HOME must be a real directory, not a symlink",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let is_default = std::env::var_os("BATUTA_HOME").is_none()
                && std::env::var_os("BATUTA_CASA").is_none();
            let legacy_state = [
                "sal",
                "salt",
                "config.txt",
                "indice.txt",
                "index.txt",
                "eventos.jsonl",
                "events.jsonl",
            ]
            .iter()
            .any(|name| directory.join(name).exists());
            if !is_default && !legacy_state && metadata.permissions().mode() & 0o077 != 0 {
                return Err(Error::new(
                    ErrorKind::PermissionDenied,
                    "existing BATUTA_HOME must already be owner-only (chmod 700)",
                ));
            }
        }
    }
    Ok(())
}

fn read_private_file(path: &Path) -> std::io::Result<String> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "state file must be a regular file, not a symlink",
        ));
    }
    storage::restrict_file(path, 0o600)?;
    fs::read_to_string(path)
}

pub fn read_state_file(name: &str) -> std::io::Result<String> {
    let candidate = Path::new(name);
    if candidate.components().count() != 1
        || !matches!(
            candidate.components().next(),
            Some(std::path::Component::Normal(_))
        )
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "state filename must not contain a path",
        ));
    }
    let directory = ensure()?;
    read_private_file(&directory.join(candidate))
}

/// Compatibility helper for the original infallible API.
pub fn ensure_dir() -> PathBuf {
    ensure().unwrap_or_else(|error| panic!("batuta: cannot secure local state directory: {error}"))
}

// ------------------------------------------------------------------------ salt

/// Returns the local salt or fails closed if the OS has no secure random source.
pub fn try_salt() -> std::io::Result<String> {
    let directory = ensure()?;
    let init_lock = directory.join("salt-init.lock");
    storage::with_exclusive_lock(init_lock, Duration::from_secs(2), || {
        try_salt_locked(&directory)
    })
}

fn try_salt_locked(directory: &Path) -> std::io::Result<String> {
    let file = directory.join("salt");
    if let Ok(value) = read_private_file(&file) {
        let value = value.trim().to_string();
        if value.len() >= 32 {
            storage::restrict_file(&file, 0o600)?;
            return Ok(value);
        }
    }

    // v0 wrote the salt as `sal`. Preserve installation IDs, prompt hashes, and
    // deterministic holdout assignment by migrating that value atomically.
    let legacy = directory.join("sal");
    if let Ok(value) = read_private_file(&legacy) {
        let value = value.trim().to_string();
        if value.len() >= 32 {
            storage::restrict_file(&legacy, 0o600)?;
            storage::atomic_write(&file, value.as_bytes(), 0o600)?;
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
    let Ok(directory) = ensure() else {
        return Config::default();
    };
    read_config_file(&directory.join("config.txt"))
}

fn read_config_file(path: &Path) -> Config {
    let mut config = Config::default();
    let Ok(contents) = read_private_file(path) else {
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
    update_config(|current| *current = config.clone())
}

fn write_config_locked(file: &Path, config: &Config) -> std::io::Result<()> {
    let body = format!(
        "# Batuta config — upload is a legacy preference; this release has no uploader\n\
         upload={}\n\
         holdout_pct={}\n\
         portal={}\n\
         informed={}\n",
        if config.upload { "yes" } else { "no" },
        config.holdout_pct,
        config.portal,
        if config.informed { "yes" } else { "no" }
    );
    storage::atomic_write(file, body.as_bytes(), 0o600)
}

pub fn update_config<F>(update: F) -> std::io::Result<()>
where
    F: FnOnce(&mut Config),
{
    update_config_with_timeout(Duration::from_secs(2), update)
}

pub fn update_config_with_timeout<F>(timeout: Duration, update: F) -> std::io::Result<()>
where
    F: FnOnce(&mut Config),
{
    let directory = ensure()?;
    let file = directory.join("config.txt");
    storage::with_exclusive_lock(directory.join("config-update.lock"), timeout, || {
        let mut config = read_config_file(&file);
        update(&mut config);
        write_config_locked(&file, &config)
    })
}

pub fn atomic_write(path: &Path, bytes: &[u8], mode: u32) -> std::io::Result<()> {
    let directory = ensure()?.canonicalize()?;
    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "state path must not contain '..'",
        ));
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let resolved_parent = parent.canonicalize()?;
    if !resolved_parent.starts_with(&directory) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "state path escapes BATUTA_HOME",
        ));
    }
    storage::atomic_write(path, bytes, mode)
}
