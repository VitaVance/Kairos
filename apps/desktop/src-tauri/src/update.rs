// Local-only update manifest reader.
//
// Deliberately has NO network code. The product is 纯本地、无云端, so the binary
// must not gain an HTTP client just to check for a new version: adding `reqwest`
// would put a network stack in an app whose whole promise is that it never talks
// to anything. Instead the user points at a `update.json` they already have —
// from a downloads page, a USB stick, or a shared folder — and we read it.
//
// This command is read-only and never invoked at startup: the frontend calls it
// only from the 「检查更新」 button.
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// A parsed manifest. Only `version` is required; the rest is presentation.
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateManifest {
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(rename = "releaseUrl")]
    pub release_url: Option<String>,
}

/// Why a read failed, as a stable code the UI maps to Chinese copy.
#[derive(Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReadError {
    /// Path empty or not absolute.
    InvalidSource,
    /// File missing or unreadable (permissions, removed drive, …).
    Unreachable,
    /// Not UTF-8, not JSON, or not the manifest shape.
    InvalidManifest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub struct ReadFailure {
    pub status: ReadError,
}

/// Read and validate a manifest at `path`.
///
/// Returns the parsed manifest or a structured failure. Errors are never
/// propagated as raw exceptions: a Tauri command error would surface an
/// OS-specific message (often in English) straight into the UI.
#[tauri::command]
pub async fn read_update_manifest(
    path: String,
) -> Result<UpdateManifest, ReadFailure> {
    // An empty or relative path is a caller bug, not a missing file. Requiring
    // an absolute path keeps "unreachable" meaning what it says.
    let trimmed = path.trim();
    if trimmed.is_empty() || !PathBuf::from(trimmed).is_absolute() {
        return Err(ReadFailure {
            status: ReadError::InvalidSource,
        });
    }

    let bytes = match std::fs::read(trimmed) {
        Ok(bytes) => bytes,
        Err(_) => {
            return Err(ReadFailure {
                status: ReadError::Unreachable,
            })
        }
    };

    // `from_slice` rejects invalid UTF-8 and malformed JSON together; a manifest
    // with extra fields still parses, which is intentional (forward compatible).
    match serde_json::from_slice::<UpdateManifest>(&bytes) {
        Ok(manifest) if !manifest.version.trim().is_empty() => Ok(manifest),
        _ => Err(ReadFailure {
            status: ReadError::InvalidManifest,
        }),
    }
}
