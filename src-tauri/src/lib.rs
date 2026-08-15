// 涓词 VocabFlow 桌面端入口
//
// 架构说明：
//   Tauri WebView (前端)  ──HTTP──▶  Node.js 后端 (localhost:3001)  ──▶  SQLite (sql.js WASM)
//
// 前端通过 index_inline-script.js 将 /api、/images、/audio 请求代理到 http://localhost:3001。
// Rust 端负责在应用启动时拉起 Node.js 后端进程，并在退出时清理。

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::Manager;

/// 解析后端资源路径（开发与打包环境兼容）
fn resolve_server_bundle(app: &tauri::App) -> Option<std::path::PathBuf> {
    // 1. 打包后：tauri::path::resource_dir() 指向 resources/ 目录
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("server").join("vocabflow-server-bundle.cjs");
        if bundled.exists() {
            return Some(bundled);
        }
    }
    // 2. 开发模式：从项目根目录的 server/dist/ 加载
    let dev_paths = [
        std::env::current_dir()
            .ok()
            .map(|p| p.join("server").join("dist").join("vocabflow-server-bundle.cjs")),
        std::env::current_dir()
            .ok()
            .map(|p| p.join("..").join("server").join("dist").join("vocabflow-server-bundle.cjs")),
    ];
    for path in dev_paths.iter().flatten() {
        if path.exists() {
            return Some(path.clone());
        }
    }
    None
}

/// 健康检查：轮询 /api/health 直到后端就绪或超时
fn wait_for_backend(timeout_secs: u64) -> bool {
    let addr: SocketAddr = "127.0.0.1:3001".parse().unwrap();
    let start = std::time::Instant::now();
    while start.elapsed().as_secs() < timeout_secs {
        if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_secs(2)) {
            let req = "GET /api/health HTTP/1.0\r\nHost: localhost:3001\r\nConnection: close\r\n\r\n";
            if stream.write_all(req.as_bytes()).is_ok() {
                let mut buf = [0u8; 256];
                if let Ok(n) = stream.read(&mut buf) {
                    let resp = String::from_utf8_lossy(&buf[..n]);
                    if resp.lines().next().map(|l| l.contains("200")).unwrap_or(false) {
                        return true;
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

/// 拉起 Node.js 后端进程
fn spawn_backend(app: &tauri::App) -> Option<Child> {
    let bundle_path = resolve_server_bundle(app)?;

    let child = Command::new("node")
        .arg(&bundle_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // 等待后端就绪（最多 15 秒）
    if !wait_for_backend(15) {
        eprintln!("[desktop] WARNING: backend did not become healthy within 15s");
    } else {
        println!("[desktop] backend already running and healthy");
    }

    Some(child)
}

/// 包装后端子进程，使用 Mutex 以便在窗口事件中安全访问
struct BackendProcess(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 启动 Node.js 后端
            if let Some(child) = spawn_backend(app) {
                app.manage(BackendProcess(Mutex::new(Some(child))));
            } else {
                eprintln!("[desktop] WARNING: failed to spawn backend server");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // 窗口关闭时终止后端进程
                if let Some(backend) = window.app_handle().try_state::<BackendProcess>() {
                    let mut guard = backend.0.lock().unwrap();
                    if let Some(child) = guard.take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
