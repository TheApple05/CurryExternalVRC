#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod catalog;
mod state;

use std::{path::PathBuf, sync::Mutex, time::Duration};
use tauri::{
    webview::{NewWindowResponse, PermissionResponse},
    Manager,
};
use tauri_plugin_opener::OpenerExt;

struct Storage(Mutex<PathBuf>);

fn navigation_allowed(url: &url::Url) -> bool {
    matches!(
        (url.scheme(), url.host_str(), url.path()),
        ("http", Some("tauri.localhost"), "/" | "/index.html")
            | ("tauri", Some("localhost"), "" | "/" | "/index.html")
    ) || url.as_str() == "about:blank"
        || url.as_str().starts_with("blob:http://tauri.localhost/")
        || url.as_str().starts_with("blob:tauri://localhost/")
}

fn external_url(raw: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(raw).map_err(|_| "Invalid link")?;
    if url.scheme() != "https"
        || raw
            .split("://")
            .nth(1)
            .and_then(|s| s.split(['/', '?', '#', '\\']).next())
            .is_some_and(|authority| authority.contains(':'))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !matches!(
            url.host_str(),
            Some("vrchat.com" | "avtrdb.com" | "vrclist.com" | "vrcmods.com" | "drive.google.com")
        )
    {
        return Err("Only approved HTTPS community links can be opened.".into());
    }
    Ok(url)
}

#[tauri::command]
fn load_state(storage: tauri::State<Storage>) -> Result<state::SavedState, String> {
    let path = storage.0.lock().map_err(|_| "Data lock unavailable")?;
    state::load(&path)
}

#[tauri::command]
fn save_state(storage: tauri::State<Storage>, state: state::SavedState) -> Result<(), String> {
    let path = storage.0.lock().map_err(|_| "Data lock unavailable")?;
    state::save(&path, &state)
}

#[tauri::command]
async fn search_avatars(
    client: tauri::State<'_, reqwest::Client>,
    query: String,
    page: u32,
) -> Result<serde_json::Value, String> {
    catalog::search(&client, query.trim(), page).await
}

#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url = external_url(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            search_avatars,
            open_external
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let data_dir = std::env::var_os("CURRYCLIENT_TEST_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(data_dir);
            app.manage(Storage(Mutex::new(data_dir.join("state.json"))));
            app.manage(
                reqwest::Client::builder()
                    .timeout(Duration::from_secs(20))
                    .redirect(reqwest::redirect::Policy::none())
                    .user_agent(concat!("CurryClient/", env!("CARGO_PKG_VERSION")))
                    .build()?,
            );
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("CurryClient")
            .inner_size(1280.0, 860.0)
            .min_inner_size(360.0, 540.0)
            .on_navigation(navigation_allowed)
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .on_permission_request(|_, _| PermissionResponse::Deny);
            #[cfg(debug_assertions)]
            let window = if let Ok(port) = std::env::var("CURRYCLIENT_TEST_CDP_PORT") {
                let port: std::num::NonZeroU16 = port.parse()?;
                // Elevated WebView2 hosts ignore browser arguments from environment variables.
                window.additional_browser_args(&format!(
                    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port={port} --remote-debugging-address=127.0.0.1"
                )).data_directory(data_dir.join("webview"))
            } else { window };
            window.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("CurryClient could not start");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigation_accepts_linux_root_without_allowing_other_origins_or_assets() {
        for raw in [
            "tauri://localhost",
            "tauri://localhost/",
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
        ] {
            assert!(navigation_allowed(&raw.parse().unwrap()), "{raw}");
        }
        for raw in [
            "tauri://evil.example",
            "tauri://localhost/other.html",
            "https://example.com",
            "file:///etc/passwd",
        ] {
            assert!(!navigation_allowed(&raw.parse().unwrap()), "{raw}");
        }
    }
    #[test]
    fn external_links_have_a_strict_boundary() {
        for raw in [
            "file:///C:/Windows/win.ini",
            "ms-settings:privacy",
            "http://vrchat.com/",
            "https://vrchat.com.evil.example/",
            "https://user:pass@vrchat.com/",
            "https://vrchat.com:444/",
            "https://vrchat.com:443/",
        ] {
            assert!(external_url(raw).is_err(), "{raw}");
        }
        assert!(external_url("https://vrchat.com/home/login").is_ok());
    }
}
