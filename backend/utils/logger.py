# backend/utils/logger.py
import os
import sys
import logging
from logging.handlers import TimedRotatingFileHandler
from backend.utils.paths import LOGS_DIR

_logging_configured = False


class _StderrTee:
    """Redirects sys.stderr to both original stderr and rotating error log."""
    def __init__(self, original_stderr, logger):
        self.original_stderr = original_stderr
        self.logger = logger
        self._buffer = ""

    def write(self, message):
        if self.original_stderr:
            try:
                self.original_stderr.write(message)
                self.original_stderr.flush()
            except Exception:
                pass
        
        # Accumulate lines
        self._buffer += message
        if "\n" in self._buffer:
            lines = self._buffer.split("\n")
            for line in lines[:-1]:
                line_str = line.strip()
                if line_str:
                    self.logger.error(line_str)
            self._buffer = lines[-1]

    def flush(self):
        if self.original_stderr:
            try:
                self.original_stderr.flush()
            except Exception:
                pass
        if self._buffer.strip():
            self.logger.error(self._buffer.strip())
            self._buffer = ""


def setup_logging():
    """Sets up daily rotating file logging for error and general application logs."""
    global _logging_configured
    if _logging_configured:
        return logging.getLogger("apiflow")

    os.makedirs(LOGS_DIR, exist_ok=True)
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] [%(name)s:%(lineno)d]: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # 1. Daily Rotating Error Log (error.log, rotasi harian tiap tengah malam)
    error_log_path = os.path.join(LOGS_DIR, "error.log")
    error_handler = TimedRotatingFileHandler(
        filename=error_log_path,
        when="midnight",
        interval=1,
        backupCount=30,
        encoding="utf-8"
    )
    error_handler.suffix = "%Y-%m-%d"
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(formatter)
    root_logger.addHandler(error_handler)

    # 2. Daily Rotating App / Info Log (app.log, rotasi harian tiap tengah malam)
    app_log_path = os.path.join(LOGS_DIR, "app.log")
    app_handler = TimedRotatingFileHandler(
        filename=app_log_path,
        when="midnight",
        interval=1,
        backupCount=30,
        encoding="utf-8"
    )
    app_handler.suffix = "%Y-%m-%d"
    app_handler.setLevel(logging.INFO)
    app_handler.setFormatter(formatter)
    root_logger.addHandler(app_handler)

    # 3. Console / Terminal Handler (Stdout)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # Attach handlers to uvicorn loggers so FastAPI & Uvicorn errors are captured daily
    for uvicorn_logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        u_logger = logging.getLogger(uvicorn_logger_name)
        u_logger.handlers = []
        u_logger.addHandler(error_handler)
        u_logger.addHandler(app_handler)
        u_logger.addHandler(console_handler)
        u_logger.propagate = False

    # 4. Intercept sys.stderr to capture unhandled tracebacks into error.log
    app_logger = logging.getLogger("apiflow")
    sys.stderr = _StderrTee(sys.stderr, logging.getLogger("stderr"))

    _logging_configured = True
    app_logger.info("Daily rotating logging initialized in %s", LOGS_DIR)
    return app_logger


def get_logger(name: str = "apiflow"):
    """Get a named logger with the daily logging configuration."""
    if not _logging_configured:
        setup_logging()
    return logging.getLogger(name)
