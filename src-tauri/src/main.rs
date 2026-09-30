#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[cfg(windows)]
#[link(name = "gdi32")]
extern "system" {
    fn CreateEllipticRgn(left: i32, top: i32, right: i32, bottom: i32) -> isize;
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn SetWindowRgn(hwnd: isize, region: isize, redraw: i32) -> i32;
}

#[tauri::command]
fn set_bubble_shape(window: tauri::WebviewWindow, bubble: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        let region = if bubble {
            let size = (88.0 * window.scale_factor().map_err(|error| error.to_string())?).round() as i32;
            unsafe { CreateEllipticRgn(0, 0, size, size) }
        } else {
            0
        };
        if bubble && region == 0 {
            return Err("无法创建圆形区域".into());
        }
        if unsafe { SetWindowRgn(hwnd, region, 1) } == 0 {
            return Err("无法设置窗口区域".into());
        }
    }
    #[cfg(not(windows))]
    let _ = (window, bubble);
    Ok(())
}

#[tauri::command]
async fn read_quotes(source: String) -> Result<String, String> {
    if source.starts_with("https://") || source.starts_with("http://") {
        let response = tauri_plugin_http::reqwest::get(&source)
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status()));
        }
        let bytes = response.bytes().await.map_err(|error| error.to_string())?;
        if bytes.len() > 1_000_000 {
            return Err("名言文件超过 1 MB".into());
        }
        String::from_utf8(bytes.to_vec()).map_err(|error| error.to_string())
    } else {
        let path = std::path::Path::new(&source);
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            return Err("请选择 .md 文件".into());
        }
        let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
        if metadata.len() > 1_000_000 {
            return Err("名言文件超过 1 MB".into());
        }
        std::fs::read_to_string(path).map_err(|error| error.to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                set_bubble_shape(window, true).map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_quotes, set_bubble_shape])
        .run(tauri::generate_context!())
        .expect("Timetipper failed to start");
}
