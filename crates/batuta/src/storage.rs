//! Private, crash-safe local storage primitives.
//!
//! Batuta's state contains the local prompt salt and correlation metadata. Every
//! directory is 0700, every file is 0600, replacements use a same-directory
//! temporary file, and append operations take a cross-process lock.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const LOCK_WAIT: Duration = Duration::from_secs(2);
const STALE_LOCK: Duration = Duration::from_secs(30);

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

pub fn ensure_private_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

pub fn restrict_file(path: &Path, mode: u32) -> io::Result<()> {
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    #[cfg(not(unix))]
    let _ = (path, mode);
    Ok(())
}

fn open_private(path: &Path, create_new: bool, append: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create(true)
        .create_new(create_new)
        .append(append);
    #[cfg(unix)]
    options.mode(0o600);
    let file = options.open(path)?;
    restrict_file(path, 0o600)?;
    Ok(file)
}

fn temporary_path(path: &Path) -> PathBuf {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state");
    path.with_file_name(format!(".{name}.tmp-{}-{counter}", std::process::id()))
}

fn replace(temp: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(not(windows))]
    {
        fs::rename(temp, destination)
    }

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "Kernel32")]
        extern "system" {
            fn MoveFileExW(existing: *const u16, replacement: *const u16, flags: u32) -> i32;
        }
        const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
        const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
        let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        // SAFETY: both buffers are NUL-terminated and remain alive for the call.
        let ok = unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

pub fn atomic_write(path: &Path, bytes: &[u8], mode: u32) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    ensure_private_dir(parent)?;
    let _guard = FileLock::acquire(path.with_extension("lock"), LOCK_WAIT)?;

    let temp = temporary_path(path);
    let result = (|| {
        let mut file = open_private(&temp, true, false)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        restrict_file(&temp, mode)?;
        replace(&temp, path)?;
        restrict_file(path, mode)?;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

pub fn append_line(path: &Path, line: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    ensure_private_dir(parent)?;
    let _guard = FileLock::acquire(path.with_extension("lock"), LOCK_WAIT)?;
    let mut file = open_private(path, false, true)?;
    file.write_all(line)?;
    file.write_all(b"\n")?;
    file.sync_data()?;
    Ok(())
}

struct FileLock {
    path: PathBuf,
}

impl FileLock {
    fn acquire(path: PathBuf, timeout: Duration) -> io::Result<Self> {
        let started = Instant::now();
        loop {
            match fs::create_dir(&path) {
                Ok(()) => {
                    #[cfg(unix)]
                    fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?;
                    return Ok(Self { path });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    let stale = fs::metadata(&path)
                        .and_then(|metadata| metadata.modified())
                        .and_then(|modified| modified.elapsed().map_err(io::Error::other))
                        .map(|age| age > STALE_LOCK)
                        .unwrap_or(false);
                    if stale {
                        let _ = fs::remove_dir(&path);
                        continue;
                    }
                    if started.elapsed() >= timeout {
                        return Err(io::Error::new(
                            io::ErrorKind::TimedOut,
                            format!("timed out acquiring {}", path.display()),
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(2));
                }
                Err(error) => return Err(error),
            }
        }
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.path);
    }
}
