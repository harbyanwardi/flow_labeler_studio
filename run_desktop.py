# run_desktop.py
"""
Desktop Entrypoint for APIFlow Labeler.
Launches the FastAPI Uvicorn backend server in a background thread
and opens a native PyWebView desktop window (or browser fallback).
"""

import os
import sys
import time
import threading
import uvicorn

import socket

# Ensure project root is in sys.path
if getattr(sys, 'frozen', False):
    ROOT_DIR = sys._MEIPASS
else:
    ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)


def start_backend(host: str = "127.0.0.1", port: int = 8000):
    """Start the FastAPI backend server using Uvicorn."""
    from backend.main import app
    uvicorn.run(app, host=host, port=port, log_level="error")


def wait_for_port(host: str, port: int, timeout: float = 30.0) -> bool:
    """Wait until the port is open and accepting connections."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return True
        except (socket.timeout, ConnectionRefusedError):
            time.sleep(0.2)
    return False


def main():
    host = "127.0.0.1"
    port = 8000
    app_url = f"http://{host}:{port}"

    # Start backend server in daemon thread
    server_thread = threading.Thread(target=start_backend, args=(host, port), daemon=True)
    server_thread.start()

    # Dynamically wait for the FastAPI backend to start
    print("Waiting for backend server to start...")
    if not wait_for_port(host, port, timeout=30.0):
        print("Error: Backend server failed to start within the timeout period.")
        # We will still try to open it just in case, but warn the user.

    # Attempt to open native Desktop Window with PyWebView
    try:
        import webview
        print(f"Launching APIFlow Labeler Desktop GUI at {app_url}...")
        webview.create_window(
            title="APIFlow Labeler Studio",
            url=app_url,
            width=1366,
            height=800,
            resizable=True,
            min_size=(1024, 600)
        )
        webview.start()
    except Exception as err:
        print(f"PyWebView error or unavailable ({err}). Falling back to default web browser...")
        import webbrowser
        webbrowser.open(app_url)
        print(f"APIFlow Labeler is running at {app_url}. Keep this window open.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("Shutting down APIFlow Labeler...")


if __name__ == "__main__":
    main()
