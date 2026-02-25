# cstrike/modules/utils/logger.py

import os
from datetime import datetime

LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, "cstrike.log")

def log(message, level="INFO"):
    timestamp = datetime.utcnow().isoformat()
    formatted = f"[{timestamp}] [{level}] {message}"
    print(formatted)
    with open(LOG_FILE, "a") as f:
        f.write(formatted + "\n")

def error(message):
    log(message, level="ERROR")

def warn(message):
    log(message, level="WARN")

def info(message):
    log(message, level="INFO")
