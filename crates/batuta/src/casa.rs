//! ~/.batuta — where Batuta keeps what belongs to it. Salt, index, events, config.
//! Nothing here uploads anywhere without explicit opt-in, and the prompt never uploads.

use crate::sha256::{hex, sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn casa() -> PathBuf {
    if let Ok(p) = std::env::var("BATUTA_CASA") {
        return PathBuf::from(p);
    }
    lar().join(".batuta")
}

pub fn lar() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

pub fn garantir() -> PathBuf {
    let c = casa();
    let _ = fs::create_dir_all(&c);
    c
}

// ------------------------------------------------------------------------ salt

/// Local salt, generated once, never transmitted. It's what makes the prompt hash
/// useless to anyone but this machine: without the salt, there's no way to test
/// a prompt guess against the published hash.
pub fn sal() -> String {
    let arq = garantir().join("sal");
    if let Ok(s) = fs::read_to_string(&arq) {
        let s = s.trim().to_string();
        if s.len() >= 32 {
            return s;
        }
    }
    let novo = gerar_sal();
    if let Ok(mut f) = fs::File::create(&arq) {
        let _ = f.write_all(novo.as_bytes());
    }
    restringir(&arq);
    novo
}

fn gerar_sal() -> String {
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
    let semente = format!("{}|{}|{:?}", nanos, std::process::id(), lar());
    hex(&sha256(semente.as_bytes()))
}

#[cfg(unix)]
fn restringir(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(p, fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn restringir(_p: &Path) {}

/// Installation identifier: derived from the salt, so it carries no username,
/// hostname, or folder path. It's only good for saying "these lines came from the
/// same machine".
pub fn id_instalacao() -> String {
    let s = sal();
    hex(&sha256(format!("instalacao|{}", s).as_bytes()))[..16].to_string()
}

// --------------------------------------------------------------------- config

#[derive(Debug, Clone)]
pub struct Config {
    pub envio: bool,
    pub holdout_pct: u32,
    pub portal: String,
    pub avisado: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            // explicit opt-in. As long as this is false, nothing leaves the machine,
            // and `batuta report` still counts in full — the local value isn't
            // hostage to the upload.
            envio: false,
            holdout_pct: 5,
            portal: "https://batuta.space".to_string(),
            avisado: false,
        }
    }
}

pub fn ler_config() -> Config {
    let mut c = Config::default();
    let arq = casa().join("config.txt");
    let Ok(s) = fs::read_to_string(arq) else {
        return c;
    };
    for linha in s.lines() {
        let linha = linha.trim();
        if linha.is_empty() || linha.starts_with('#') {
            continue;
        }
        let Some((k, v)) = linha.split_once('=') else {
            continue;
        };
        let v = v.trim();
        match k.trim() {
            "envio" => c.envio = v == "sim" || v == "true" || v == "1",
            "holdout_pct" => c.holdout_pct = v.parse().unwrap_or(5).min(50),
            "portal" => c.portal = v.to_string(),
            "avisado" => c.avisado = v == "sim" || v == "true" || v == "1",
            _ => {}
        }
    }
    c
}

pub fn gravar_config(c: &Config) {
    let arq = garantir().join("config.txt");
    let corpo = format!(
        "# config do Batuta — nada sobe daqui enquanto envio=nao\n\
         envio={}\n\
         holdout_pct={}\n\
         portal={}\n\
         avisado={}\n",
        if c.envio { "sim" } else { "nao" },
        c.holdout_pct,
        c.portal,
        if c.avisado { "sim" } else { "nao" }
    );
    let _ = fs::write(arq, corpo);
}
