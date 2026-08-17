//! VocabFlow 桌面端 Rust 主逻辑
//!
//! 职责：
//!   1. 生产模式下以子进程启动内嵌的 Node.js Express 服务端
//!   2. 等待服务端就绪后初始化 Tauri 应用
//!   3. 暴露 `get_api_base` / `is_backend_ready` / `get_backend_error` 命令供前端调用
//!
//! 注意：开发模式下 (tauri dev) 服务端由 beforeDevCommand + concurrently 启动，
//!      不需要子进程。

#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

// Windows 专用：通过 CREATE_NO_WINDOW 标志隐藏子进程控制台窗口
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows 进程创建标志：CREATE_NO_WINDOW
/// 阻止子进程弹出黑色控制台窗口
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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
    let mut cmd = Command::new("node");
    cmd.arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    if cmd.status().is_ok() {
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

/// 去除 Windows 扩展路径前缀 `\\?\`（verbatim prefix）
///
/// Tauri 的 `resource_dir()` 返回的路径可能带有 `\\?\` 前缀，
/// 这是 Windows 的扩展长度路径前缀。Node.js 在解析脚本路径时
/// 会对路径做 `realpathSync`，`\\?\E:\...` 会被错误解析导致
/// `EISDIR: illegal operation on a directory, lstat 'E:'` 错误。
fn strip_verbatim_prefix(path: &str) -> String {
    // Windows verbatim prefix: \\?\  或  \\?\UNC\
    if let Some(stripped) = path.strip_prefix(r"\\?\") {
        // \\?\UNC\server\share → \\server\share
        if let Some(unc) = stripped.strip_prefix("UNC\\") {
            format!(r"\\{}", unc.replace('\\', "\\"))
        } else {
            stripped.to_string()
        }
    } else {
        path.to_string()
    }
}

/// 在资源目录中查找指定文件，尝试多个可能的子路径
/// Tauri 打包 resources 时会保留相对路径的目录结构
fn find_resource_file(resource_dir: &PathBuf, filename: &str) -> Option<PathBuf> {
    // 收集所有可能的路径
    let candidates = [
        // 1. 直接在资源根目录下
        resource_dir.join(filename),
        // 2. Tauri 相对路径 ../server/dist/ 会映射为 _up_/server/dist/
        resource_dir.join("_up_").join("server").join("dist").join(filename),
        // 3. 其他常见子目录
        resource_dir.join("server").join("dist").join(filename),
        resource_dir.join("resources").join(filename),
    ];

    for path in &candidates {
        if path.exists() {
            // 去除 \\?\ 前缀，避免 Node.js realpathSync 解析失败
            let clean = strip_verbatim_prefix(&path.to_string_lossy());
            return Some(PathBuf::from(clean));
        }
    }

    // 4. 递归搜索（最后的兜底）
    fn search_dir(dir: &PathBuf, filename: &str, depth: u32) -> Option<PathBuf> {
        if depth > 3 {
            return None;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.file_name().map(|n| n == filename).unwrap_or(false) {
                    let clean = strip_verbatim_prefix(&path.to_string_lossy());
                    return Some(PathBuf::from(clean));
                }
                if path.is_dir() {
                    if let Some(found) = search_dir(&path.to_path_buf(), filename, depth + 1) {
                        return Some(found);
                    }
                }
            }
        }
        None
    }

    search_dir(resource_dir, filename, 0)
}

#[tauri::command]
fn get_api_base() -> ApiBase {
    ApiBase {
        url: format!("http://localhost:{}", API_PORT),
    }
}

/// 标记后端是否已就绪（前端可轮询）
static BACKEND_READY: AtomicBool = AtomicBool::new(false);

/// 后端启动错误信息（前端可通过 get_backend_error 命令获取）
static BACKEND_ERROR: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
fn is_backend_ready() -> bool {
    BACKEND_READY.load(Ordering::Relaxed)
}

#[tauri::command]
fn get_backend_error() -> Option<String> {
    BACKEND_ERROR.lock().unwrap().clone()
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

                log_to_file(&format!("资源目录: {:?}", resource_path));

                // 使用智能查找定位资源文件
                let server_script = find_resource_file(&resource_path, "vocabflow-server-bundle.cjs");
                let wasm_path = find_resource_file(&resource_path, "sql-wasm.wasm");

                log_to_file(&format!(
                    "server 脚本: {:?} (存在: {})",
                    server_script,
                    server_script.is_some()
                ));
                log_to_file(&format!(
                    "wasm 文件: {:?} (存在: {})",
                    wasm_path,
                    wasm_path.is_some()
                ));

                // 将 wasm 复制到用户数据目录
                if let Some(ref wasm) = wasm_path {
                    let home = std::env::var("USERPROFILE")
                        .or_else(|_| std::env::var("HOME"))
                        .unwrap_or_else(|_| ".".to_string());
                    let dest = PathBuf::from(&home).join(".vocabflow").join("sql-wasm.wasm");
                    let _ = std::fs::create_dir_all(dest.parent().unwrap());
                    match std::fs::copy(wasm, &dest) {
                        Ok(_) => log_to_file(&format!("wasm 已复制到: {:?}", dest)),
                        Err(e) => log_to_file(&format!("wasm 复制失败: {}", e)),
                    }
                } else {
                    let msg = "未找到 sql-wasm.wasm 资源文件".to_string();
                    log_to_file(&msg);
                    *BACKEND_ERROR.lock().unwrap() = Some(msg);
                }

                // 检查 server 脚本是否存在
                let server_script = match server_script {
                    Some(path) => path,
                    None => {
                        let msg = "未找到 vocabflow-server-bundle.cjs 资源文件".to_string();
                        log_to_file(&msg);
                        *BACKEND_ERROR.lock().unwrap() = Some(msg);
                        return Ok(());
                    }
                };

                // 查找 node
                let node = match find_node() {
                    Some(n) => {
                        log_to_file(&format!("找到 node: {}", n));
                        n
                    }
                    None => {
                        let msg = "未找到 Node.js 可执行文件，请安装 Node.js (v18+) 并加入系统 PATH".to_string();
                        log_to_file(&msg);
                        *BACKEND_ERROR.lock().unwrap() = Some(msg);
                        return Ok(());
                    }
                };

                // 在后台线程中启动后端并等待就绪
                let script_path = server_script.to_string_lossy().to_string();
                std::thread::spawn(move || {
                    log_to_file(&format!("正在启动后端: {} {}", node, script_path));

                    let mut cmd = Command::new(&node);
                    cmd.arg(&script_path)
                        .env("PORT", API_PORT.to_string())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped());

                    // Windows: 使用 CREATE_NO_WINDOW 标志隐藏子进程控制台窗口
                    #[cfg(target_os = "windows")]
                    cmd.creation_flags(CREATE_NO_WINDOW);

                    match cmd.spawn()
                    {
                        Ok(mut child) => {
                            log_to_file("Express 子进程已启动，等待就绪...");

                            // 用 Arc<Mutex<String>> 收集 stderr 输出，供错误信息使用
                            let stderr_buf = std::sync::Arc::new(std::sync::Mutex::new(String::new()));

                            // 在后台读取 stdout 并写入日志文件
                            if let Some(stdout) = child.stdout.take() {
                                std::thread::spawn(move || {
                                    use std::io::{BufRead, BufReader};
                                    let reader = BufReader::new(stdout);
                                    for line in reader.lines().flatten() {
                                        log_to_file(&format!("[node:out] {}", line));
                                    }
                                });
                            }
                            // 在后台读取 stderr 并写入日志文件 + 收集到 buffer
                            if let Some(stderr) = child.stderr.take() {
                                let buf = stderr_buf.clone();
                                std::thread::spawn(move || {
                                    use std::io::{BufRead, BufReader};
                                    let reader = BufReader::new(stderr);
                                    for line in reader.lines().flatten() {
                                        log_to_file(&format!("[node:err] {}", line));
                                        if buf.lock().unwrap().len() < 2000 {
                                            buf.lock().unwrap().push_str(&line);
                                            buf.lock().unwrap().push('\n');
                                        }
                                    }
                                    log_to_file("[node] stderr 已关闭");
                                });
                            }

                            // 轮询检查端口是否可连接，同时检测子进程是否已提前退出
                            let addr = format!("127.0.0.1:{}", API_PORT);
                            let start = Instant::now();
                            let timeout = Duration::from_secs(30);
                            let mut ready = false;
                            let mut exit_code: Option<i32> = None;

                            while start.elapsed() < timeout {
                                // 如果子进程已退出，说明启动失败
                                match child.try_wait() {
                                    Ok(Some(status)) => {
                                        exit_code = status.code();
                                        log_to_file(&format!(
                                            "后端子进程已退出，退出码: {:?}",
                                            exit_code
                                        ));
                                        break;
                                    }
                                    Ok(None) => {} // 还在运行
                                    Err(e) => {
                                        let msg = format!("检查子进程状态失败: {}", e);
                                        log_to_file(&msg);
                                        *BACKEND_ERROR.lock().unwrap() = Some(msg);
                                        break;
                                    }
                                }
                                if TcpStream::connect(&addr).is_ok() {
                                    ready = true;
                                    break;
                                }
                                std::thread::sleep(Duration::from_millis(500));
                            }

                            if ready {
                                log_to_file("后端已就绪");
                                BACKEND_READY.store(true, Ordering::Relaxed);
                            } else {
                                // 等待 stderr 线程读取完毕（给一点时间让 buffer 写入）
                                std::thread::sleep(Duration::from_millis(500));

                                let stderr_content = stderr_buf.lock().unwrap().clone();
                                let mut err = BACKEND_ERROR.lock().unwrap();
                                if err.is_none() {
                                    if let Some(code) = exit_code {
                                        // 子进程已退出，包含 stderr 内容
                                        if !stderr_content.is_empty() {
                                            *err = Some(format!(
                                                "Node.js 进程启动后退出 (退出码: {})\n\n错误输出:\n{}",
                                                code, stderr_content.trim()
                                            ));
                                        } else {
                                            *err = Some(format!(
                                                "Node.js 进程启动后退出 (退出码: {})，无错误输出。请检查 Node.js 版本是否为 v18+",
                                                code
                                            ));
                                        }
                                    } else {
                                        *err = Some("后端服务在 30 秒内未能启动就绪".to_string());
                                    }
                                }
                                log_to_file(&format!("后端未能在超时内就绪: {}", err.as_ref().unwrap()));
                            }
                            // 保持 child 不被 drop（否则会 kill 进程）
                            std::mem::forget(child);
                        }
                        Err(e) => {
                            let msg = format!("启动 Node.js 进程失败: {}", e);
                            log_to_file(&msg);
                            *BACKEND_ERROR.lock().unwrap() = Some(msg);
                        }
                    }
                });
            }

            // 开发模式提示
            #[cfg(debug_assertions)]
            {
                println!("[tauri] 开发模式 — 请确保后端已通过 `npm run dev:all` 启动");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_api_base, is_backend_ready, get_backend_error])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
