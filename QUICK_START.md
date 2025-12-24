# CStrike Web UI - Quick Start Guide

## 🚀 Getting Started (3 Easy Steps)

### **Step 1: Install Dependencies**

```bash
# Python API dependencies
pip install -r api_requirements.txt

# Frontend dependencies
cd web && npm install && cd ..
```

### **Step 2: Start CStrike**

**Option A: Automated (Recommended)**
```bash
./start_cstrike_web.sh
```

**Option B: Manual**
```bash
# Terminal 1 - Start API server
python3 api_server.py

# Terminal 2 - Start frontend
cd web && npm run dev
```

### **Step 3: Open Your Browser**

Visit: **http://localhost:3000**

---

## 📊 What You'll See

**Dashboard View:**
- Real-time system metrics (CPU, RAM, VPN IP)
- Service status (Metasploit, ZAP, Burp)
- Phase progress indicators
- Quick statistics

**Available Modules:**
- 🎯 **Dashboard** - Live system monitoring
- 🔍 **Reconnaissance** - Target scanning tools
- 🧠 **AI Stream** - AI decision visualization
- 💰 **Loot** - Credential tracker
- 📜 **Logs** - Live log viewer
- 🎯 **Exploitation** - Attack tools
- ⚙️ **Services** - Service management

---

## 🛠️ Configuration

Edit `.env` file to configure:

```json
{
  "target_scope": ["example.com"],
  "openai_api_key": "sk-...",
  "allow_exploitation": true,
  "scan_modes": ["http", "dns", "port", "vulnscan"],
  "allowed_tools": ["nmap", "subfinder", "amass", "nikto"],
  "max_threads": 10,
  "msf_username": "msf",
  "msf_password": "password",
  "zap_host": "127.0.0.1",
  "zap_port": 8090
}
```

---

## 🔧 Troubleshooting

### **WebSocket Error (ECONNREFUSED)**

**Cause:** Python API server isn't running
**Fix:**
```bash
python3 api_server.py
```

### **Module Import Errors**

**Cause:** Missing Python dependencies
**Fix:**
```bash
pip install -r requirements.txt
pip install -r api_requirements.txt
```

### **Port Already in Use**

**Backend (8000):**
```bash
lsof -ti:8000 | xargs kill -9
```

**Frontend (3000):**
```bash
lsof -ti:3000 | xargs kill -9
```

---

## 📚 Next Steps

1. **Add Targets** - Go to Reconnaissance → Add your first target
2. **Start Services** - Go to Services → Start Metasploit/ZAP/Burp
3. **Run Scans** - Go to Reconnaissance → Select tools → Start scan
4. **View Results** - Check Loot tracker and Logs for findings
5. **AI Insights** - Watch AI Stream for intelligent recommendations

---

## 🔗 Useful Links

- **Frontend:** http://localhost:3000
- **API Docs:** http://localhost:8000/api/v1/status
- **WebSocket:** ws://localhost:8000
- **Logs:** `tail -f logs/api_server.log`

---

## 🎯 Common Workflows

### **Basic Reconnaissance**
1. Add target: `example.com`
2. Select tools: nmap, subfinder, httpx
3. Click "Start Scan"
4. Watch live output in Logs
5. Review findings in Loot

### **Web Application Testing**
1. Start ZAP service
2. Add web target
3. Run nuclei scan
4. Check AI recommendations
5. Review vulnerabilities

### **Credential Harvesting**
1. Run full port scan
2. Enable service enumeration
3. Check Loot → Usernames
4. Run credential reuse attacks
5. Export results to CSV

---

## ⚠️ Legal Notice

**CStrike is for authorized security testing only.**

- ✅ Use on systems you own or have permission to test
- ✅ Penetration testing engagements
- ✅ Red team exercises
- ✅ Security research
- ❌ Unauthorized access
- ❌ Malicious attacks

---

## 🆘 Support

**Issues?** Check the logs:
```bash
# API Server logs
tail -f logs/api_server.log

# Frontend build errors
cd web && npm run build
```

**Still stuck?**
- Read `DEPLOYMENT.md` for detailed setup
- Check `README.md` for architecture details
- Review `CSTRIKE_WEB_UI_COMPLETE.md` for feature overview

---

**Happy Hacking! 🎯**
