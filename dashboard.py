# /opt/ai_driver/dashboard.py

import curses
import json
import subprocess
import time
import psutil
from pathlib import Path
from modules.ai_assistant import get_thoughts

LOG_FILE = "/opt/ai_driver/logs/driver.log"
MAX_LINES = 200
ICONS = {
    "target": "[✓]",
    "phase": "[▶]",
    "ai": "[🧠]",
    "loot": "[🔓]",
    "exploit": "[🧪]",
    "services": "[⚙️]",
    "error": "[✗]",
    "warn": "[!]"
}
PHASES = ["recon", "ai", "zap_burp", "metasploit", "exploitation"]

def read_log_tail():
    if not Path(LOG_FILE).exists():
        return []
    with open(LOG_FILE, "r") as f:
        lines = f.readlines()
        return lines[-MAX_LINES:]

def parse_log_lines(lines):
    stages = {}
    for line in lines:
        for phase in PHASES:
            if phase in line.lower():
                if "Starting" in line or "Running" in line:
                    stages[phase] = "running"
                elif "Completed" in line or "Wrote" in line:
                    stages[phase] = "done"
        if "Starting recon for target" in line:
            target = line.split("target:")[-1].strip()
            stages.setdefault("target", target)
    return stages

def get_vpn_ip():
    for iface in ["wg0", "tun0"]:
        try:
            check = subprocess.run(["ip", "link", "show", iface], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if check.returncode != 0:
                continue
            output = subprocess.check_output(["curl", "--interface", iface, "-s", "https://ifconfig.me"], stderr=subprocess.DEVNULL).decode()
            return output.strip()
        except Exception:
            continue
    return "Not connected"

def service_status(service_name):
    try:
        result = subprocess.run(["pgrep", "-f", service_name], stdout=subprocess.DEVNULL)
        return "running" if result.returncode == 0 else "stopped"
    except:
        return "unknown"

def draw_dashboard(stdscr):
    curses.curs_set(0)
    stdscr.nodelay(True)
    stdscr.timeout(1000)
    show_logs = False
    log_filter = None
    scroll_offset = 0

    while True:
        stdscr.erase()
        lines = read_log_tail()
        data = parse_log_lines(lines)
        vpn_ip = get_vpn_ip()
        thoughts = get_thoughts()

        # Header
        stdscr.addstr(1, 2, "CStrike - Status Dashboard", curses.A_BOLD | curses.color_pair(6))
        stdscr.addstr(1, 42, f"VPN IP: {vpn_ip}", curses.color_pair(1))

        # System stats
        cpu = psutil.cpu_percent()
        ram = psutil.virtual_memory().percent
        stdscr.addstr(2, 42, f"CPU: {cpu:.1f}%  RAM: {ram:.1f}%", curses.color_pair(1))

        # Services
        metasploit = service_status("msfrpcd")
        zap = service_status("zap")
        burp = service_status("burpsuite")

        def status_box(name, status, col):
            icon = ICONS["target"] if status == "running" else ICONS["error"]
            color = curses.color_pair(3) if status == "running" else curses.color_pair(5)
            stdscr.addstr(3, col, f"{icon} {name}", color)

        status_box("Metasploit RPC", metasploit, 4)
        status_box("ZAP", zap, 26)
        status_box("Burp", burp, 42)

        # Target & Phases
        stdscr.addstr(5, 4, f"{ICONS['target']} Target: ", curses.color_pair(2))
        stdscr.addstr(f"{data.get('target', 'N/A')}", curses.color_pair(7))

        row = 7
        for phase in PHASES:
            status = data.get(phase, "pending")
            color = curses.color_pair(3 if status == "done" else 4 if status == "running" else 5)
            stdscr.addstr(row, 4, f"{ICONS['phase']} {phase:<15}", curses.color_pair(2))
            stdscr.addstr(f"{status}", color)
            row += 1

        # AI thoughts
        stdscr.addstr(row + 1, 4, f"{ICONS['ai']} AI Thoughts:", curses.color_pair(2))
        for i, thought in enumerate(thoughts[-5:], start=1):
            stdscr.addstr(row + 1 + i, 6, f"{thought[:70]}", curses.color_pair(7))

        # Menu
        row += 8
        stdscr.addstr(row, 2, "(3) View Live Logs (4) Start Services (5) Stop Services", curses.color_pair(1))
        stdscr.addstr(row + 2, 2, "Press 'q' to quit. Press 'f' to filter logs for [ERROR] or [WARN]", curses.color_pair(1))

        if show_logs:
            stdscr.hline(row + 4, 0, "-", 80, curses.color_pair(6))
            stdscr.addstr(row + 5, 2, "Live Log Output:", curses.A_BOLD | curses.color_pair(6))
            filtered = [line for line in lines if (log_filter in line if log_filter else True)]
            visible = filtered[-(curses.LINES - row - 8 + scroll_offset):-scroll_offset or None]
            for i, log_line in enumerate(visible):
                color = curses.color_pair(5) if "ERROR" in log_line else curses.color_pair(4) if "WARN" in log_line else curses.color_pair(7)
                stdscr.addstr(row + 6 + i, 2, log_line.strip()[:75], color)

        stdscr.refresh()

        try:
            key = stdscr.getkey()
            if key.lower() == "q":
                break
            elif key == "3":
                show_logs = not show_logs
            elif key == "4":
                subprocess.Popen(["systemctl", "start", "msfrpcd"])
                subprocess.Popen(["zap", "-daemon"])
                subprocess.Popen(["burpsuite"])
            elif key == "5":
                subprocess.Popen(["pkill", "-f", "msfrpcd"])
                subprocess.Popen(["pkill", "-f", "zap"])
                subprocess.Popen(["pkill", "-f", "burpsuite"])
            elif key.lower() == "f":
                log_filter = None if log_filter else "ERROR"
        except:
            continue

def init_colors_and_run(stdscr):
    curses.start_color()
    curses.use_default_colors()
    curses.init_pair(1, curses.COLOR_WHITE, -1)
    curses.init_pair(2, curses.COLOR_CYAN, -1)
    curses.init_pair(3, curses.COLOR_GREEN, -1)
    curses.init_pair(4, curses.COLOR_YELLOW, -1)
    curses.init_pair(5, curses.COLOR_RED, -1)
    curses.init_pair(6, curses.COLOR_MAGENTA, -1)
    curses.init_pair(7, curses.COLOR_WHITE, -1)
    draw_dashboard(stdscr)

def main():
    curses.wrapper(init_colors_and_run)

# ✅ Add this so ai_driver.py can import it
def live_dashboard():
    curses.wrapper(init_colors_and_run)

if __name__ == "__main__":
    main()
