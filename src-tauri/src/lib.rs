//! VocabFlow 桌面端 Rust 主逻辑
//!
//! 职责：
//!   1. 生产模式下以子进程启动内嵌的 Node.js Express 服务端
//!      —— 使用 std::process::Command 直接拉起 node + 打包的 server bundle
//!   2. 等待服务端就绪后初始化 Tauri 应用
//!   3. 暴露 `get_api_base` 命令供前端获取后端地址
//!
//! 注意：开发模式下 (tauri dev) 服务端由 beforeDevCommand + concurrently 启动，
//!      不需要子进程。

// dev 模式下不编译 sidecar 相关代码，抑制 dead_code 警告
#![allow(dead_code)]

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// API 端口（与 server/src/index.ts 默认一致）
const API_PORT: u16 = 3001;

#[derive(serde::Serialize)]
struct ApiBase {
    url: String,
}

/// 将日志写入用户目录下的文件，方便排查问题
fn log_to_file(msg: &str) {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    let log_dir = format!("{}/.vocabflow", home);
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = format!("{}/desktop.log", log_dir);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("[{}] {}\n", ts, msg);
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
}

/// 查找系统 node 可执行文件
fn find_node() -> Option<String> {
    // 直接尝试 PATH 中的 node
    if Command::new("node")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok()
    {
        return Some("node".to_string());
    }

    // 尝试常见安装路径（Windows）
    let candidates = [
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
        r"E:\nodejs\node.exe",
        r"D:\nodejs\node.exe",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }

    // 从 PATH 环境变量中搜索
    if let Ok(paths) = std::env::var("PATH") {
        for dir in paths.split(';') {
            let node_path = PathBuf::from(dir).join("node.exe");
            if node_path.exists() {
                return Some(node_path.to_string_lossy().to_string());
            }
        }
    }

    None
}

/// 等待后端端口可连接，最长 30 秒
fn wait_for_server() -> bool {
    let addr = format!("127.0.0.1:{}", API_PORT);
    let start = Instant::now();
    let timeout = Duration::from_secs(30);

    while start.elapsed() < timeout {
        if TcpStream::connect(&addr).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}

#[tauri::command]
fn get_api_base() -> ApiBase {
    ApiBase {
        url: format!("http://localhost:{}", API_PORT),
    }
}

/// 标记后端是否已就绪（前端可轮询）
static BACKEND_READY: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn is_backend_ready() -> bool {
    BACKEND_READY.load(Ordering::Relaxed)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 仅在生产模式启动后端子进程
            #[cfg(not(debug_assertions))]
            {
                let resource_path = app
                    .path()
                    .resource_dir()
                    .expect("无法获取资源目录");

                let server_script = resource_path.join("vocabflow-server-bundle.cjs");
                let wasm_path = resource_path.join("sql-wasm.wasm");

                log_to_file(&format!("资源目录: {:?}", resource_path));
                log_to_file(&format!("server 脚本: {:?} (存在: {})", server_script, server_script.exists()));
                log_to_file(&format!("wasm 文件: {:?} (存在: {})", wasm_path, wasm_path.exists()));

                // 将 wasm 复制到用户数据目录（db.ts 从 cwd / __dirname 查找）
                if wasm_path.exists() {
                    let home = std::env::var("USERPROFILE")
                        .or_else(|_| std::env::var("HOME"))
                        .unwrap_or_else(|_| ".".to_string());
                    let dest = PathBuf::from(&home).join(".vocabflow").join("sql-wasm.wasm");
                    let _ = std::fs::create_dir_all(dest.parent().unwrap());
                    match std::fs::copy(&wasm_path, &dest) {
                        Ok(_) => log_to_file(&format!("wasm 已复制到: {:?}", dest)),
                        Err(e) => log_to_file(&format!("wasm 复制失败: {}", e)),
                    }
                }

                // 查找 node
                let node = match find_node() {
                    Some(n) => {
                        log_to_file(&format!("找到 node: {}", n));
                        n
                    }
                    None => {
                        let msg = "未找到 node 可执行文件！请安装 Node.js 并加入 PATH";
                        log_to_file(msg);
                        eprintln!("[tauri] {}", msg);
                        // 不再阻塞，让前端显示错误提示
                        return Ok(());
                    }
                };

                if server_script.exists() {
                    // 在后台线程中启动后端并等待就绪
                    let script_path = server_script.to_string_lossy().to_string();
                    std::thread::spawn(move || {
                        log_to_file(&format!("正在启动后端: {} {}", node, script_path));

                        match Command::new(&node)
                            .arg(&script_path)
                            .env("PORT", API_PORT.to_string())
                            .stdout(Stdio::null())
                            .stderr(Stdio::null())
                            .spawn()
                        {
                            Ok(child) => {
                                log_to_file("Express 子进程已启动，等待就绪...");
                                // 保存 child 以便退出时 kill
                                // 注意：app.manage 需要在主线程调用，
                                // 这里通过全局变量保存 PID
                                if wait_for_server() {
                                    log_to_file("后端已就绪");
                                    BACKEND_READY.store(true, Ordering::Relaxed);
                                } else {
                                    log_to_file("后端未能在超时内就绪");
                                }
                                // 保持 child 不被 drop（否则会 kill 进程）
                                std::mem::forget(child);
                            }
                            Err(e) => {
                                log_to_file(&format!("启动后端失败: {}", e));
                            }
                        }
                    });
                } else {
                    let msg = format!("未找到服务端脚本: {:?}", server_script);
                    log_to_file(&msg);
                    eprintln!("[tauri] {}", msg);
                }
            }

            // 开发模式提示
            #[cfg(debug_assertions)]
            {
                println!("[tauri] 开发模式 — 请确保后端已通过 `npm run dev:all` 启动");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_api_base, is_backend_ready])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
