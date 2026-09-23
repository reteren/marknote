use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> anyhow::Result<()> {
    let temp_path = temporary_path(path)?;
    let result = (|| {
        let mut temp = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        temp.write_all(bytes)?;
        temp.sync_all()?;
        drop(temp);

        replace_existing(&temp_path, path)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    result.map_err(Into::into)
}

fn temporary_path(path: &Path) -> anyhow::Result<PathBuf> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("target path has no file name: {}", path.display()))?
        .to_string_lossy();

    for _ in 0..100 {
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".{name}.marknote-{counter}.tmp"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(anyhow::anyhow!(
        "could not allocate a temporary path beside {}",
        path.display()
    ))
}

fn replace_existing(temp_path: &Path, target_path: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;

        let source = temp_path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let target = target_path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();

        // Replace the target through Win32 MoveFileExW without deleting it first.
        use windows_sys::Win32::Foundation::GetLastError;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };

        let replaced = unsafe {
            MoveFileExW(
                source.as_ptr(),
                target.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if replaced == 0 {
            let error = unsafe { GetLastError() };
            return Err(io::Error::from_raw_os_error(error as i32));
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        fs::rename(temp_path, target_path)?;
        let parent = target_path.parent().unwrap_or_else(|| Path::new("."));
        OpenOptions::new().read(true).open(parent)?.sync_all()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_path(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("marknote-atomic-{stamp}-{name}"))
    }

    #[test]
    fn writes_new_file() {
        let path = test_path("new");
        write_atomic(&path, b"new content").expect("atomic write failed");
        assert_eq!(fs::read(&path).expect("read failed"), b"new content");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn overwrites_existing_file() {
        let path = test_path("overwrite");
        fs::write(&path, b"old content").expect("initial write failed");
        write_atomic(&path, b"new content").expect("atomic write failed");
        assert_eq!(fs::read(&path).expect("read failed"), b"new content");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn resulting_content_matches_input() {
        let path = test_path("bytes");
        let input = b"\0binary\xFF bytes\r\n";
        write_atomic(&path, input).expect("atomic write failed");
        assert_eq!(fs::read(&path).expect("read failed"), input);
        let _ = fs::remove_file(path);
    }
}
