#!/usr/bin/env python3
"""
JusticeAI Project Orchestrator & Runner
---------------------------------------
1. Checks for Node.js and npm in system PATH.
2. Checks if node_modules exists; if not (or if --force-install is passed), runs npm install / npm ci.
3. Allows choosing dev mode (default) or production build & start.
4. Streams ALL terminal stdout and stderr unbuffered directly to the console (no encapsulation or hiding).
5. Provides command-line options for port, host, offline dummy-mode, and automated health probing.

Usage:
    python start.py
    python start.py --prod
    python start.py --port 3111
    python start.py --offline
    python start.py --skip-probe
"""

import os
import sys
import shutil
import subprocess
import argparse
import time
import urllib.request
import urllib.error
import json
import threading

DEFAULT_PORT = 3111
DEFAULT_HOST = "0.0.0.0"

def log_banner(msg: str):
    print("\n" + "=" * 70, flush=True)
    print(f" [JusticeAI Runner] {msg}", flush=True)
    print("=" * 70 + "\n", flush=True)

def check_prerequisites():
    log_banner("1. Checking Prerequisites (Node.js & npm)")
    node_path = shutil.which("node")
    npm_path = shutil.which("npm") or shutil.which("npm.cmd")

    if not node_path:
        print("[ERROR] 'node' is not found in your system PATH.", flush=True)
        print("Please install Node.js (v18+ recommended) before running this script.", flush=True)
        sys.exit(1)

    if not npm_path:
        print("[ERROR] 'npm' is not found in your system PATH.", flush=True)
        sys.exit(1)

    try:
        node_ver = subprocess.check_output([node_path, "--version"], text=True).strip()
        npm_ver = subprocess.check_output([npm_path, "--version"], shell=True, text=True).strip()
        print(f"  ✓ Found Node.js: {node_ver} ({node_path})", flush=True)
        print(f"  ✓ Found npm:     {npm_ver} ({npm_path})", flush=True)
    except Exception as e:
        print(f"  ! Warning reading versions: {e}", flush=True)

    return node_path, npm_path

def ensure_dependencies(project_root: str, npm_cmd: str, force: bool = False):
    log_banner("2. Verifying Node Modules (Dependencies)")
    node_modules_dir = os.path.join(project_root, "node_modules")
    package_json = os.path.join(project_root, "package.json")
    package_lock = os.path.join(project_root, "package-lock.json")

    if not os.path.exists(package_json):
        print(f"[ERROR] package.json not found in {project_root}", flush=True)
        sys.exit(1)

    need_install = force or not os.path.exists(node_modules_dir)

    if need_install:
        print("node_modules missing or re-install requested. Installing dependencies...", flush=True)
        install_cmd = [npm_cmd, "ci"] if os.path.exists(package_lock) else [npm_cmd, "install"]
        print(f"Running: {' '.join(install_cmd)} in {project_root}", flush=True)
        # Run directly without pipe so all stdout/stderr streams to current console in real time
        res = subprocess.run(install_cmd, cwd=project_root, shell=(os.name == "nt"))
        if res.returncode != 0:
            print(f"[ERROR] npm installation failed with exit code {res.returncode}", flush=True)
            sys.exit(res.returncode)
        print("  ✓ Dependencies successfully installed.", flush=True)
    else:
        print(f"  ✓ node_modules already present in {node_modules_dir}.", flush=True)

def probe_health_worker(port: int, stop_event: threading.Event):
    """Wait for server to accept connections and print health diagnostic"""
    target_url = f"http://127.0.0.1:{port}/api/health?full=1&is_working=1"
    print(f"\n[Health Probe] Background monitor waiting for server on port {port}...", flush=True)
    
    start_time = time.time()
    max_wait = 90  # seconds
    server_up = False

    while not stop_event.is_set() and (time.time() - start_time) < max_wait:
        time.sleep(2)
        try:
            req = urllib.request.Request(
                target_url,
                headers={"User-Agent": "JusticeAI-Python-Probe/1.0", "Accept": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                status = resp.getcode()
                body = resp.read().decode("utf-8")
                try:
                    data = json.loads(body)
                except Exception:
                    data = {}

                print("\n" + "#" * 60, flush=True)
                print(f"[Health Probe] Server is responsive! (HTTP {status})", flush=True)
                overall_ok = data.get("ok", False)
                print(f"[Health Probe] Overall Status: {'OK (Healthy)' if overall_ok else 'DEGRADED / PARTIAL'}", flush=True)
                corpus = data.get("corpus", {})
                if corpus:
                    print(f"[Health Probe] Corpus: {corpus.get('sections', 0)} sections across {corpus.get('acts', 0)} acts", flush=True)
                models = data.get("models", {})
                if models:
                    print(f"[Health Probe] Models: text={models.get('text')} fast={models.get('fast')}", flush=True)
                degraded = data.get("degraded", [])
                if degraded:
                    print(f"[Health Probe] Degraded optional services: {', '.join(degraded)}", flush=True)
                print(f"[Health Probe] Open UI in browser: http://localhost:{port}", flush=True)
                print("#" * 60 + "\n", flush=True)
                server_up = True
                break
        except (urllib.error.URLError, ConnectionResetError, ConnectionRefusedError, TimeoutError, OSError):
            continue
        except Exception:
            continue

    if not server_up and not stop_event.is_set():
        print(f"\n[Health Probe] Note: Server did not return health JSON within {max_wait}s (compilation might still be running).", flush=True)

def main():
    parser = argparse.ArgumentParser(description="JusticeAI Node.js Server & Environment Orchestrator")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Port to bind Next.js server to (default: {DEFAULT_PORT})")
    parser.add_argument("--host", type=str, default=DEFAULT_HOST, help=f"Host address to bind to (default: {DEFAULT_HOST})")
    parser.add_argument("--prod", action="store_true", help="Build and start Next.js in production mode instead of dev")
    parser.add_argument("--force-install", action="store_true", help="Force npm install / ci even if node_modules exists")
    parser.add_argument("--offline", action="store_true", help="Run with dummy offline keys (no Groq token consumption / offline safe)")
    parser.add_argument("--skip-probe", action="store_true", help="Skip automatic health probing after launch")
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.abspath(__file__))
    os.chdir(project_root)

    print("\n" + "=" * 70, flush=True)
    print(" JusticeAI — Legal Co-pilot Orchestration Runner", flush=True)
    print("=" * 70, flush=True)
    print(f"Project directory: {project_root}", flush=True)
    print(f"Target port:       {args.port}", flush=True)
    print(f"Target mode:       {'PRODUCTION' if args.prod else 'DEVELOPMENT (Turbopack/Hot-reload)'}", flush=True)
    if args.offline:
        print("Offline mode:      ENABLED (dummy key injected; zero token spend)", flush=True)

    # 1. Prerequisite verification
    node_cmd, npm_cmd = check_prerequisites()

    # 2. Dependency installation
    ensure_dependencies(project_root, npm_cmd, force=args.force_install)

    # 3. Environment variable setup
    env = os.environ.copy()
    if args.offline:
        env["GROQ_API_KEY"] = "dummy-offline-key"
        env["FIREBASE_ADMIN_SERVICE_ACCOUNT_B64"] = ""
        env["FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON"] = ""

    # Ensure unbuffered node output
    env["NODE_ENV"] = "production" if args.prod else "development"
    env["PORT"] = str(args.port)
    env["HOSTNAME"] = args.host

    # 4. Optional production build
    if args.prod:
        log_banner("Building Next.js Production Bundle (npm run build)")
        build_cmd = [npm_cmd, "run", "build"]
        print(f"Running: {' '.join(build_cmd)}", flush=True)
        res = subprocess.run(build_cmd, cwd=project_root, env=env, shell=(os.name == "nt"))
        if res.returncode != 0:
            print(f"[ERROR] Next.js build failed with exit code {res.returncode}", flush=True)
            sys.exit(res.returncode)
        server_cmd = [npm_cmd, "run", "start", "--", "-p", str(args.port), "-H", args.host]
    else:
        # Dev server
        server_cmd = [npm_cmd, "run", "dev", "--", "-p", str(args.port), "-H", args.host]

    # 5. Start background health monitor if requested
    stop_probe_event = threading.Event()
    if not args.skip_probe:
        probe_thread = threading.Thread(
            target=probe_health_worker,
            args=(args.port, stop_probe_event),
            daemon=True
        )
        probe_thread.start()

    # 6. Execute server directly with NO encapsulation (all stdout/stderr streams to console)
    log_banner(f"Starting Server: {' '.join(server_cmd)}")
    print(f"Access URL: http://localhost:{args.port}\n", flush=True)

    try:
        # Running with shell=True on Windows passes through current stdin, stdout, stderr directly.
        # No pipes, no encapsulation.
        proc = subprocess.Popen(
            server_cmd,
            cwd=project_root,
            env=env,
            shell=(os.name == "nt")
        )
        proc.wait()
    except KeyboardInterrupt:
        print("\n[JusticeAI Runner] Caught shutdown signal (Ctrl+C). Terminating server...", flush=True)
        stop_probe_event.set()
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        print("[JusticeAI Runner] Server stopped gracefully.", flush=True)
    except Exception as e:
        print(f"\n[ERROR] Unexpected execution failure: {e}", flush=True)
        sys.exit(1)
    finally:
        stop_probe_event.set()

if __name__ == "__main__":
    main()
