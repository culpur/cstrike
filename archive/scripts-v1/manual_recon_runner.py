# cstrike/manual_recon_runner.py

import sys
import logging
from pathlib import Path
from datetime import datetime, timezone
from modules.recon import run_recon_layered

if len(sys.argv) < 2:
    print("Usage: python3 manual_recon_runner.py <target>")
    sys.exit(1)

target = sys.argv[1]
timestamp = datetime.now(timezone.utc).isoformat()

# Optional: Ensure results directory exists
results_dir = Path("results") / target
results_dir.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    filename="logs/driver.log",
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s"
)

logging.info(f"[Manual Trigger] Starting manual recon for target: {target}")
recon_results = run_recon_layered(target)
logging.info(f"[Manual Trigger] Completed manual recon for {target}")
