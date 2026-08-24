//! Private, crash-safe local storage primitives.
//!
//! Batuta's state contains the local prompt salt and correlation metadata. Every
//! directory is 0700, every file is 0600, replacements use a same-directory
//! temporary file, and append operations take a cross-process lock.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const LOCK_WAIT: Duration = Duration::from_secs(2);
const STALE_LOCK: Duration = Duration::from_secs(30);

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

#[cfg(any(target_os = "linux", target_os = "android"))]
const O_NOFOLLOW: i32 = 0x20000;
#[cfg(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd",
    target_os = "dragonfly"
))]
const O_NOFOLLOW: i32 = 0x100;

pub fn ensure_private_dir(path: &Path) -> io::Result<()> {
    #[cfg(not(unix))]
    {
        let _ = path;
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "owner-only state ACLs are not implemented on this platform",
        ));
    }
    #[cfg(unix)]
    {
        let mut current = PathBuf::new();
        for component in path.components() {
            current.push(component.as_os_str());
            if !matches!(component, std::path::Component::Normal(_)) {
                continue;
            }
            let mut created = false;
            match fs::symlink_metadata(&current) {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        format!("{} is not a real directory", current.display()),
                    ));
                }
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    match fs::create_dir(&current) {
                        Ok(()) => created = true,
                        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                        Err(error) => return Err(error),
                    }
                    let metadata = fs::symlink_metadata(&current)?;
                    if metadata.file_type().is_symlink() || !metadata.is_dir() {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidInput,
                            format!("{} is not a real directory", current.display()),
                        ));
                    }
                }
                Err(error) => return Err(error),
            }
            if created {
                fs::set_permissions(&current, fs::Permissions::from_mode(0o700))?;
            }
        }
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        Ok(())
    }
}

pub fn restrict_file(path: &Path, mode: u32) -> io::Result<()> {
    #[cfg(unix)]
    {
        let mut options = OpenOptions::new();
        options.read(true).custom_flags(O_NOFOLLOW);
        let file = options.open(path)?;
        if !file.metadata()?.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("{} is not a regular file", path.display()),
            ));
        }
        file.set_permissions(fs::Permissions::from_mode(mode))?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let _ = (path, mode);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "owner-only state ACLs are not implemented on this platform",
        ))
    }
}

fn open_private(path: &Path, create_new: bool, append: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options
        .read(append)
        .write(true)
        .create(true)
        .create_new(create_new)
        .append(append);
    #[cfg(unix)]
    options.mode(0o600).custom_flags(O_NOFOLLOW);
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} is not a regular file", path.display()),
        ));
    }
    #[cfg(unix)]
    file.set_permissions(fs::Permissions::from_mode(0o600))?;
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
    recover_partial_tail(&mut file)?;
    let mut framed = Vec::with_capacity(line.len() + 1);
    framed.extend_from_slice(line);
    framed.push(b'\n');
    file.write_all(&framed)?;
    file.sync_data()?;
    Ok(())
}

fn recover_partial_tail(file: &mut File) -> io::Result<()> {
    let length = file.metadata()?.len();
    if length == 0 {
        return Ok(());
    }
    file.seek(SeekFrom::End(-1))?;
    let mut last = [0_u8; 1];
    file.read_exact(&mut last)?;
    if last[0] == b'\n' {
        return Ok(());
    }

    let mut end = length;
    let mut buffer = [0_u8; 4096];
    while end > 0 {
        let start = end.saturating_sub(buffer.len() as u64);
        let span = (end - start) as usize;
        file.seek(SeekFrom::Start(start))?;
        file.read_exact(&mut buffer[..span])?;
        if let Some(position) = buffer[..span].iter().rposition(|byte| *byte == b'\n') {
            file.set_len(start + position as u64 + 1)?;
            file.sync_data()?;
            return Ok(());
        }
        end = start;
    }
    file.set_len(0)?;
    file.sync_data()
}

pub fn with_exclusive_lock<T, F>(path: PathBuf, timeout: Duration, operation: F) -> io::Result<T>
where
    F: FnOnce() -> io::Result<T>,
{
    let _guard = FileLock::acquire(path, timeout)?;
    operation()
}

struct FileLock {
    file: File,
}

#[cfg(unix)]
fn try_os_lock(file: &File) -> io::Result<bool> {
    use std::os::fd::AsRawFd;
    extern "C" {
        fn flock(fd: std::os::raw::c_int, operation: std::os::raw::c_int) -> std::os::raw::c_int;
    }
    const LOCK_EX: std::os::raw::c_int = 2;
    const LOCK_NB: std::os::raw::c_int = 4;
    // SAFETY: `file` owns a valid descriptor for the duration of this call.
    if unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) } == 0 {
        Ok(true)
    } else {
        let error = io::Error::last_os_error();
        if matches!(error.raw_os_error(), Some(11 | 35)) {
            Ok(false)
        } else {
            Err(error)
        }
    }
}

#[cfg(unix)]
fn unlock_os(file: &File) {
    use std::os::fd::AsRawFd;
    extern "C" {
        fn flock(fd: std::os::raw::c_int, operation: std::os::raw::c_int) -> std::os::raw::c_int;
    }
    const LOCK_UN: std::os::raw::c_int = 8;
    // SAFETY: `file` remains live until after this unlock attempt.
    let _ = unsafe { flock(file.as_raw_fd(), LOCK_UN) };
}

#[cfg(windows)]
#[repr(C)]
struct Overlapped {
    internal: usize,
    internal_high: usize,
    offset: u32,
    offset_high: u32,
    event: *mut std::ffi::c_void,
}

#[cfg(windows)]
fn try_os_lock(file: &File) -> io::Result<bool> {
    use std::os::windows::io::AsRawHandle;
    #[link(name = "Kernel32")]
    extern "system" {
        fn LockFileEx(
            file: *mut std::ffi::c_void,
            flags: u32,
            reserved: u32,
            bytes_low: u32,
            bytes_high: u32,
            overlapped: *mut Overlapped,
        ) -> i32;
    }
    const LOCKFILE_FAIL_IMMEDIATELY: u32 = 0x1;
    const LOCKFILE_EXCLUSIVE_LOCK: u32 = 0x2;
    let mut overlapped = Overlapped {
        internal: 0,
        internal_high: 0,
        offset: 0,
        offset_high: 0,
        event: std::ptr::null_mut(),
    };
    // SAFETY: the handle and OVERLAPPED buffer are valid for this synchronous call.
    if unsafe {
        LockFileEx(
            file.as_raw_handle(),
            LOCKFILE_FAIL_IMMEDIATELY | LOCKFILE_EXCLUSIVE_LOCK,
            0,
            1,
            0,
            &mut overlapped,
        )
    } != 0
    {
        Ok(true)
    } else {
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(33) {
            Ok(false)
        } else {
            Err(error)
        }
    }
}

#[cfg(windows)]
fn unlock_os(file: &File) {
    use std::os::windows::io::AsRawHandle;
    #[link(name = "Kernel32")]
    extern "system" {
        fn UnlockFileEx(
            file: *mut std::ffi::c_void,
            reserved: u32,
            bytes_low: u32,
            bytes_high: u32,
            overlapped: *mut Overlapped,
        ) -> i32;
    }
    let mut overlapped = Overlapped {
        internal: 0,
        internal_high: 0,
        offset: 0,
        offset_high: 0,
        event: std::ptr::null_mut(),
    };
    // SAFETY: the handle remains valid and describes the same byte range.
    let _ = unsafe { UnlockFileEx(file.as_raw_handle(), 0, 1, 0, &mut overlapped) };
}

impl FileLock {
    fn acquire(path: PathBuf, timeout: Duration) -> io::Result<Self> {
        let started = Instant::now();
        loop {
            if path.is_dir() {
                let stale = fs::metadata(&path)
                    .and_then(|metadata| metadata.modified())
                    .and_then(|modified| modified.elapsed().map_err(io::Error::other))
                    .map(|age| age > STALE_LOCK)
                    .unwrap_or(false);
                if stale {
                    let _ = fs::remove_dir(&path);
                    continue;
                }
            } else {
                let file = open_private(&path, false, false)?;
                if try_os_lock(&file)? {
                    return Ok(Self { file });
                }
            }
            if started.elapsed() >= timeout {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!("timed out acquiring {}", path.display()),
                ));
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        unlock_os(&self.file);
    }
}
