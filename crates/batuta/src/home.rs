//! ~/.batuta — where Batuta keeps what belongs to it. Salt, index, events, config.
//! Nothing here uploads anywhere without explicit opt-in, and the prompt never uploads.

use crate::sha256::{hex, sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn app_dir() -> PathBuf {
    if let Ok(p) = std::env::var("BATUTA_HOME") {
        return PathBuf::from(p);
    }
    user_home().join(".batuta")
}

pub fn user_home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

pub fn ensure_dir() -> PathBuf {
    let c = app_dir();
    let _ = fs::create_dir_all(&c);
    c
}

// ------------------------------------------------------------------------ salt

/// Local salt, generated once, never transmitted. It's what makes the prompt hash
/// useless to anyone but this machine: without the salt, there's no way to test
/// a prompt guess against the published hash.
pub fn salt() -> String {
    let file = ensure_dir().join("salt");
    if let Ok(s) = fs::read_to_string(&file) {
        let s = s.trim().to_string();
        if s.len() >= 32 {
            return s;
        }
    }
    let new = generate_salt();
    if let Ok(mut f) = fs::File::create(&file) {
        let _ = f.write_all(new.as_bytes());
    }
    restrict(&file);
    new
}

fn generate_salt() -> String {
    // WARNING: /dev/urandom HAS NO END. `fs::read` on it reads forever and eats
    // all the machine's memory — that's exactly what happened in the first version
    // of this. It has to be a fixed-size read.
    if let Ok(mut f) = fs::File::open("/dev/urandom") {
        use std::io::Read;
        let mut b = [0u8; 32];
        if f.read_exact(&mut b).is_ok() {
            return hex(&sha256(&b));
        }
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seed = format!("{}|{}|{:?}", nanos, std::process::id(), user_home());
    hex(&sha256(seed.as_bytes()))
}

#[cfg(unix)]
fn restrict(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(p, fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn restrict(_p: &Path) {}

/// Installation identifier: derived from the salt, so it carries no username,
/// hostname, or folder path. It's only good for saying "these lines came from the
/// same machine".
pub fn installation_id() -> String {
    let s = salt();
    hex(&sha256(format!("installation|{}", s).as_bytes()))[..16].to_string()
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
        Config {
            // explicit opt-in. As long as this is false, nothing leaves the machine,
            // and `batuta report` still counts in full — the local value isn't
            // hostage to the upload.
            upload: false,
            holdout_pct: 5,
            portal: "https://batuta.space".to_string(),
            informed: false,
        }
    }
}

pub fn read_config() -> Config {
    let mut c = Config::default();
    let file = app_dir().join("config.txt");
    let Ok(s) = fs::read_to_string(file) else {
        return c;
    };
    for line in s.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let v = v.trim();
        match k.trim() {
            "upload" => c.upload = v == "yes" || v == "true" || v == "1",
            "holdout_pct" => c.holdout_pct = v.parse().unwrap_or(5).min(50),
            "portal" => c.portal = v.to_string(),
            "informed" => c.informed = v == "yes" || v == "true" || v == "1",
            _ => {}
        }
    }
    c
}

pub fn write_config(c: &Config) {
    let file = ensure_dir().join("config.txt");
    let body = format!(
        "# Batuta config — nothing leaves this machine while upload=no\n\
         upload={}\n\
         holdout_pct={}\n\
         portal={}\n\
         informed={}\n",
        if c.upload { "yes" } else { "no" },
        c.holdout_pct,
        c.portal,
        if c.informed { "yes" } else { "no" }
    );
    let _ = fs::write(file, body);
}
