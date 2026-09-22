use thiserror::Error;

/// User-facing text shared by IPC commands, window routing, and startup.
#[derive(Debug, Error, Clone, Copy)]
pub(crate) enum UserMessage {
    #[error("Could not read or write the file. Check your permissions and try again.")]
    FileIo,
    #[error("Could not save the file. Check that the destination is writable and try again.")]
    AtomicWrite,
    #[error("Could not convert the document to this format.")]
    FormatConversion,
    #[error("Could not open the file dialog. Try again.")]
    Dialog,
    #[error("This file format is not supported.")]
    UnknownFormat,
    #[error("This format is read-only.")]
    ReadOnlyFormat,
    #[error("This file appears to be binary and cannot be opened as text.")]
    BinaryFile,
    #[error(
        "This file changed on disk after you opened it. Reload it to see the latest version, or save a copy to avoid overwriting external changes."
    )]
    FileConflict,
    #[error("This image is too large to display. The maximum size is 16 MiB.")]
    ImageTooLarge,
    #[error("The selected path is invalid.")]
    InvalidPath,
    #[error("Could not access the application window. Try again.")]
    Window,
    #[error("This file is read-only.")]
    FileReadOnly,
    #[error("This format cannot be used for a new document.")]
    FormatCannotCreate,
    #[error("Image paths must be relative to the document.")]
    ImagePathMustBeRelative,
    #[error("Absolute and device paths are not allowed for images.")]
    ImagePathAbsoluteOrDevice,
    #[error("Save the document before using relative image links.")]
    DocumentPathRequired,
    #[error("The document path cannot be used to resolve relative images.")]
    DeviceDocumentPath,
    #[error("Save the document in a folder to resolve relative image links.")]
    DocumentFolderRequired,
    #[error("Image paths must stay within the document folder.")]
    ImagePathOutsideDocument,
    #[error("The image link does not point to a regular file.")]
    ImageNotRegularFile,
    #[error("This image file type is not supported.")]
    ImageUnsupported,
    #[cfg(not(windows))]
    #[error("Reveal in File Explorer is only available on Windows.")]
    ExplorerWindowsOnly,
    #[error("Could not route the file to a window. Try again.")]
    WindowRouting,
    #[error("The main window is unavailable. Restart MarkNote and try again.")]
    MainWindowUnavailable,
    #[error("MarkNote could not start. Try again.")]
    StartupFailure,
}

impl UserMessage {
    pub(crate) fn path_resolution(path: &str) -> String {
        format!("Could not resolve “{path}”. Check that the path exists and try again.")
    }
}
