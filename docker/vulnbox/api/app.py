#!/usr/bin/env python3
"""VulnBox REST API — Deliberately Vulnerable Flask API
Vulnerabilities present (intentional):
  - SQL injection in /api/v1/login and /api/v1/search
  - RCE via /api/v1/exec
  - IDOR in /api/v1/users/<id>
  - Debug info disclosure in /api/v1/debug and /api/v1/config
  - SSRF via /api/v1/fetch                        (#3)
  - Weak JWT secret + alg:none bypass             (#4)
  - Fake AWS IMDS at /latest/meta-data/           (#7)
  - SSTI via /api/v1/render                       (#10)
"""
import os, subprocess, sqlite3, json, base64, hmac, hashlib, time
from functools import wraps
from flask import Flask, request, jsonify, g, render_template_string

# Optional imports — graceful fallback if not installed
try:
    import requests as http_requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

try:
    import jwt as pyjwt
    PYJWT_AVAILABLE = True
except ImportError:
    PYJWT_AVAILABLE = False

try:
    from flask_cors import CORS
    cors_available = True
except ImportError:
    cors_available = False

app = Flask(__name__)
if cors_available:
    CORS(app)

# ── Hardcoded secrets (intentional) ──────────────────────────────────────────
API_SECRET    = "master-key-do-not-share-98765"
ADMIN_TOKEN   = "admin-token-super-secret-12345"
DB_PATH       = "/opt/vulnapi/api.db"

# Vuln #4 — weak, guessable JWT secret
JWT_SECRET    = "secret"
JWT_ALGORITHM = "HS256"

# ── Database helpers ──────────────────────────────────────────────────────────
def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db:
        db.close()

def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute(
        'CREATE TABLE IF NOT EXISTS api_users ('
        'id INTEGER PRIMARY KEY AUTOINCREMENT, '
        'username TEXT UNIQUE, password TEXT, '
        'role TEXT DEFAULT "user", api_key TEXT)'
    )
    db.execute(
        'CREATE TABLE IF NOT EXISTS api_notes ('
        'id INTEGER PRIMARY KEY AUTOINCREMENT, '
        'user_id INTEGER, title TEXT, content TEXT, private INTEGER DEFAULT 0)'
    )
    try:
        db.execute("INSERT INTO api_users (username, password, role, api_key) VALUES (?, ?, ?, ?)",
                   ("admin", "admin123", "admin", "vuln-api-key-admin-00001"))
        db.execute("INSERT INTO api_users (username, password, role, api_key) VALUES (?, ?, ?, ?)",
                   ("user",  "user123",  "user",  "vuln-api-key-user-00002"))
        db.execute("INSERT INTO api_users (username, password, role, api_key) VALUES (?, ?, ?, ?)",
                   ("service", "service", "service", "vuln-api-key-svc-00003"))
        db.execute("INSERT INTO api_notes (user_id, title, content, private) VALUES (1, 'SSH Keys', 'Root key at /root/.ssh/id_rsa', 1)")
        db.execute("INSERT INTO api_notes (user_id, title, content, private) VALUES (1, 'Deploy Creds', 'deploy:deploy on all servers', 1)")
        db.execute("INSERT INTO api_notes (user_id, title, content, private) VALUES (2, 'Public Note', 'This is a public note', 0)")
        db.commit()
    except sqlite3.IntegrityError:
        pass
    db.close()

# ── Auth helpers ──────────────────────────────────────────────────────────────
def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        api_key = request.headers.get('X-API-Key') or request.args.get('api_key')
        if not api_key:
            return jsonify({"error": "API key required"}), 401
        db = get_db()
        user = db.execute("SELECT * FROM api_users WHERE api_key = ?", (api_key,)).fetchone()
        if not user:
            return jsonify({"error": "Invalid API key"}), 401
        g.current_user = dict(user)
        return f(*args, **kwargs)
    return decorated

# ── Vuln #4: JWT helpers (weak secret + alg:none bypass) ─────────────────────
def _issue_jwt(payload: dict) -> str:
    """Issue a HS256-signed JWT using the weak secret 'secret'."""
    payload = dict(payload)
    payload.setdefault('iat', int(time.time()))
    payload.setdefault('exp', int(time.time()) + 3600)
    if PYJWT_AVAILABLE:
        return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    # Manual fallback implementation
    header  = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b'=').decode()
    body    = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b'=').decode()
    signing_input = f"{header}.{body}"
    sig = hmac.new(JWT_SECRET.encode(), signing_input.encode(), hashlib.sha256).digest()
    signature = base64.urlsafe_b64encode(sig).rstrip(b'=').decode()
    return f"{signing_input}.{signature}"

def _decode_jwt_vulnerable(token: str) -> dict:
    """Deliberately vulnerable JWT decode — accepts alg:none tokens."""
    parts = token.split('.')
    if len(parts) != 3:
        raise ValueError("Invalid token format")

    try:
        header_raw = parts[0] + '=' * (-len(parts[0]) % 4)
        header = json.loads(base64.urlsafe_b64decode(header_raw))
    except Exception:
        raise ValueError("Cannot decode header")

    try:
        body_raw = parts[1] + '=' * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(body_raw))
    except Exception:
        raise ValueError("Cannot decode payload")

    alg = header.get('alg', '').lower()

    # Vuln: alg:none bypass — skip signature verification entirely
    if alg == 'none':
        return payload

    # Normal HS256 path (still weak secret)
    if alg == 'hs256':
        if PYJWT_AVAILABLE:
            try:
                return pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            except Exception as e:
                raise ValueError(str(e))
        # Manual verification
        signing_input = f"{parts[0]}.{parts[1]}"
        expected_sig = hmac.new(JWT_SECRET.encode(), signing_input.encode(), hashlib.sha256).digest()
        expected_b64 = base64.urlsafe_b64encode(expected_sig).rstrip(b'=').decode()
        if not hmac.compare_digest(expected_b64, parts[2]):
            raise ValueError("Signature verification failed")
        return payload

    raise ValueError(f"Unsupported algorithm: {alg}")

# ── Core routes ───────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return jsonify({
        "service": "VulnBox API",
        "version": "2.0.0",
        "endpoints": [
            "GET  /api/v1/users",
            "POST /api/v1/login",
            "GET  /api/v1/notes",
            "POST /api/v1/exec",
            "GET  /api/v1/config",
            "GET  /api/v1/debug",
            "GET  /api/v1/fetch?url=<url>          [SSRF]",
            "POST /api/v1/jwt/issue                [JWT - weak secret]",
            "POST /api/v1/jwt/verify               [JWT - alg:none bypass]",
            "GET  /api/v1/render?template=<tpl>    [SSTI]",
            "GET  /latest/meta-data/               [Fake IMDS]",
        ],
        "auth": "X-API-Key header",
        "debug": True
    })

@app.route('/api/v1/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    username = data.get('username', '')
    password = data.get('password', '')
    db = get_db()
    # Vuln: SQLi — string interpolation into query
    query = f"SELECT * FROM api_users WHERE username = '{username}' AND password = '{password}'"
    try:
        user = db.execute(query).fetchone()
        if user:
            token = ADMIN_TOKEN if user['role'] == 'admin' else "user-token"
            return jsonify({"success": True, "user": dict(user), "token": token})
        return jsonify({"success": False, "error": "Invalid credentials"}), 401
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/v1/users')
def list_users():
    db = get_db()
    users = db.execute("SELECT id, username, role, api_key FROM api_users").fetchall()
    return jsonify({"users": [dict(u) for u in users]})

@app.route('/api/v1/users/<int:user_id>')
def get_user(user_id):
    db = get_db()
    # Vuln: IDOR — no auth, returns all fields including password
    user = db.execute("SELECT * FROM api_users WHERE id = ?", (user_id,)).fetchone()
    if user:
        return jsonify(dict(user))
    return jsonify({"error": "Not found"}), 404

@app.route('/api/v1/notes')
@require_auth
def list_notes():
    db = get_db()
    # Vuln: returns all notes including private ones, ignores user context
    notes = db.execute("SELECT * FROM api_notes").fetchall()
    return jsonify({"notes": [dict(n) for n in notes]})

@app.route('/api/v1/notes/<int:note_id>')
def get_note(note_id):
    db = get_db()
    note = db.execute("SELECT * FROM api_notes WHERE id = ?", (note_id,)).fetchone()
    if note:
        return jsonify(dict(note))
    return jsonify({"error": "Not found"}), 404

@app.route('/api/v1/search')
def search():
    q = request.args.get('q', '')
    db = get_db()
    # Vuln: SQLi
    try:
        results = db.execute(
            f"SELECT id, username, role FROM api_users WHERE username LIKE '%{q}%'"
        ).fetchall()
        return jsonify({"results": [dict(r) for r in results]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/v1/exec', methods=['POST'])
@require_auth
def exec_command():
    data = request.get_json() or {}
    cmd = data.get('cmd', '')
    if not cmd:
        return jsonify({"error": "cmd required"}), 400
    # Vuln: RCE — unsanitized shell command execution
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        return jsonify({"stdout": result.stdout, "stderr": result.stderr, "returncode": result.returncode})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Timed out"}), 408

@app.route('/api/v1/config')
def get_config():
    return jsonify({
        "database": DB_PATH,
        "api_secret": API_SECRET,
        "jwt_secret": JWT_SECRET,
        "debug": True,
        "server_info": {
            "hostname": subprocess.getoutput("hostname"),
            "kernel":   subprocess.getoutput("uname -r"),
        }
    })

@app.route('/api/v1/debug')
def debug():
    return jsonify({
        "env":  dict(os.environ),
        "user": subprocess.getoutput("whoami"),
        "id":   subprocess.getoutput("id"),
    })

@app.route('/api/v1/health')
def health():
    return jsonify({"status": "healthy", "service": "vulnbox-api"})

# ── Vuln #3: SSRF — arbitrary URL fetch ───────────────────────────────────────
@app.route('/api/v1/fetch')
def ssrf_fetch():
    """
    SSRF endpoint — fetches arbitrary URLs server-side.
    No allow-list, no protocol restrictions, no timeout protection.

    Examples:
      /api/v1/fetch?url=http://169.254.169.254/latest/meta-data/
      /api/v1/fetch?url=http://127.0.0.1:6379/
      /api/v1/fetch?url=file:///etc/passwd
      /api/v1/fetch?url=http://10.0.0.1:9090/api/v1/config
    """
    url = request.args.get('url', '')
    if not url:
        return jsonify({"error": "url parameter required",
                        "example": "/api/v1/fetch?url=http://169.254.169.254/latest/meta-data/"}), 400

    if not REQUESTS_AVAILABLE:
        # Fallback using curl — also vulnerable (subprocess injection possible)
        try:
            result = subprocess.run(['curl', '-s', '-L', '--max-time', '10', url],
                                    capture_output=True, text=True, timeout=15)
            return jsonify({"url": url, "status": 0, "body": result.stdout, "error": result.stderr})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    try:
        resp = http_requests.get(
            url,
            timeout=10,
            allow_redirects=True,
            verify=False,         # no TLS verification
            headers={"User-Agent": "VulnBox-Fetcher/1.0"}
        )
        return jsonify({
            "url":         url,
            "status_code": resp.status_code,
            "headers":     dict(resp.headers),
            "body":        resp.text[:8192],
        })
    except Exception as e:
        return jsonify({"error": str(e), "url": url}), 500

# ── Vuln #4: JWT endpoints — weak secret + alg:none bypass ───────────────────
@app.route('/api/v1/jwt/issue', methods=['POST'])
def jwt_issue():
    """
    Issue a JWT signed with the weak secret 'secret'.
    POST {"username": "admin", "role": "admin"}
    """
    data = request.get_json() or {}
    username = data.get('username', 'anonymous')
    role     = data.get('role',     'user')
    payload  = {
        "sub":      username,
        "role":     role,
        "iss":      "vulnbox-api",
        "iat":      int(time.time()),
        "exp":      int(time.time()) + 3600,
    }
    token = _issue_jwt(payload)
    return jsonify({
        "token":     token,
        "algorithm": JWT_ALGORITHM,
        "secret":    "hint: it's a common word",
        "note":      "Try alg:none bypass or brute-force the secret",
    })

@app.route('/api/v1/jwt/verify', methods=['POST'])
def jwt_verify():
    """
    Verify a JWT — deliberately accepts alg:none tokens.
    POST {"token": "<jwt>"}
    or Authorization: Bearer <jwt>

    alg:none bypass:
      1. Decode the token (base64)
      2. Change "alg":"HS256" -> "alg":"none"
      3. Change "role":"user" -> "role":"admin"
      4. Re-encode header+payload, set signature to empty string
      Token: <new_header>.<new_payload>.
    """
    data  = request.get_json() or {}
    token = data.get('token', '')
    if not token:
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]
    if not token:
        return jsonify({"error": "token required (body.token or Authorization: Bearer)"}), 400

    try:
        payload = _decode_jwt_vulnerable(token)
        return jsonify({"valid": True, "payload": payload,
                        "note": "Accepted — alg:none tokens bypass signature check"})
    except Exception as e:
        return jsonify({"valid": False, "error": str(e)}), 401

# ── Vuln #7: Fake AWS IMDS ─────────────────────────────────────────────────────
_FAKE_IMDS = {
    "/latest/meta-data/":
        "ami-id\nami-launch-index\nami-manifest-path\nblock-device-mapping/\nhostname\n"
        "iam/\ninstance-action\ninstance-id\ninstance-type\nlocal-hostname\nlocal-ipv4\n"
        "network/\nplacement/\npublic-hostname\npublic-ipv4\nreservation-id\nsecurity-groups\n",
    "/latest/meta-data/ami-id":             "ami-0abcdef1234567890",
    "/latest/meta-data/instance-id":        "i-0deadbeef1234567",
    "/latest/meta-data/instance-type":      "t3.medium",
    "/latest/meta-data/local-ipv4":         "10.10.10.100",
    "/latest/meta-data/public-ipv4":        "203.0.113.42",
    "/latest/meta-data/hostname":           "ip-10-10-10-100.ec2.internal",
    "/latest/meta-data/security-groups":    "launch-wizard-1",
    "/latest/meta-data/iam/":              "info\nsecurity-credentials/\n",
    "/latest/meta-data/iam/info": json.dumps({
        "Code":               "Success",
        "LastUpdated":        "2024-01-15T12:00:00Z",
        "InstanceProfileArn": "arn:aws:iam::123456789012:instance-profile/prod-ec2-role",
        "InstanceProfileId":  "AIPA1234567890EXAMPLE",
    }),
    "/latest/meta-data/iam/security-credentials/":
        "prod-ec2-role\n",
    "/latest/meta-data/iam/security-credentials/prod-ec2-role": json.dumps({
        "Code":            "Success",
        "LastUpdated":     "2024-01-15T12:00:00Z",
        "Type":            "AWS-HMAC",
        "AccessKeyId":     "AKIAIOSFODNN7EXAMPLE",
        "SecretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        "Token":           "AQoDYXdzEJr//////////wEaoAK1wvxJY12r2IWAkL"
                           "K8t4IiM4uKjMJmFAqXXXXXXXXXXXXXXXXXXXXXXX"
                           "FakeSessionTokenForPentestingPurposesOnly==",
        "Expiration":      "2099-12-31T23:59:59Z",
    }),
    "/latest/meta-data/placement/availability-zone": "us-east-1a",
    "/latest/meta-data/placement/region":            "us-east-1",
    "/latest/user-data": (
        "#!/bin/bash\n"
        "# Startup script\n"
        "export DB_PASSWORD='SuperSecret2024!'\n"
        "export INTERNAL_API_KEY='internal-svc-key-do-not-expose'\n"
        "export SLACK_WEBHOOK='https://hooks.slack.com/services/FAKE/FAKE/FAKE'\n"
        "/opt/setup/bootstrap.sh\n"
    ),
    "/latest/dynamic/instance-identity/document": json.dumps({
        "accountId":         "123456789012",
        "architecture":      "x86_64",
        "availabilityZone":  "us-east-1a",
        "imageId":           "ami-0abcdef1234567890",
        "instanceId":        "i-0deadbeef1234567",
        "instanceType":      "t3.medium",
        "privateIp":         "10.10.10.100",
        "region":            "us-east-1",
    }),
}

@app.route('/latest/meta-data/', defaults={'subpath': ''})
@app.route('/latest/meta-data/<path:subpath>')
def imds_metadata(subpath):
    """Fake AWS IMDS — simulates http://169.254.169.254/latest/meta-data/"""
    path = '/latest/meta-data/' + subpath
    if path in _FAKE_IMDS:
        return _FAKE_IMDS[path], 200, {'Content-Type': 'text/plain'}
    return "404 Not Found", 404, {'Content-Type': 'text/plain'}

@app.route('/latest/user-data')
def imds_userdata():
    return _FAKE_IMDS['/latest/user-data'], 200, {'Content-Type': 'text/plain'}

@app.route('/latest/dynamic/instance-identity/document')
def imds_iid():
    return _FAKE_IMDS['/latest/dynamic/instance-identity/document'], 200, {'Content-Type': 'application/json'}

@app.route('/latest/')
def imds_root():
    return "dynamic\nmeta-data\nuser-data\n", 200, {'Content-Type': 'text/plain'}

# ── Vuln #10: SSTI — Jinja2 template injection ────────────────────────────────
@app.route('/api/v1/render')
def ssti_render():
    """
    SSTI endpoint — passes user input directly to render_template_string().
    This executes arbitrary Jinja2 templates, enabling RCE via:

      /api/v1/render?template={{7*7}}
      /api/v1/render?template={{config.items()}}
      /api/v1/render?template={{''.__class__.__mro__[1].__subclasses__()}}
      /api/v1/render?template={{request.application.__globals__.__builtins__.__import__('os').popen('id').read()}}

    Full RCE chain:
      {{''.__class__.__mro__[1].__subclasses__()[<idx>].__init__.__globals__['__builtins__']['__import__']('os').popen('id').read()}}
    """
    template = request.args.get('template', '')
    if not template:
        return jsonify({
            "error": "template parameter required",
            "example": "/api/v1/render?template=Hello+{{7*7}}",
            "hint": "Try: {{config.items()}} or {{''.__class__.__mro__}}",
        }), 400

    try:
        # Deliberately vulnerable — user input passed directly to render_template_string
        result = render_template_string(template)
        return jsonify({"template": template, "rendered": result})
    except Exception as e:
        return jsonify({"error": str(e), "template": template}), 500

# ── OpenAPI spec ──────────────────────────────────────────────────────────────
@app.route('/swagger.json')
@app.route('/openapi.json')
def openapi_spec():
    return jsonify({
        "openapi": "3.0.0",
        "info": {"title": "VulnBox API", "version": "2.0.0"},
        "paths": {
            "/api/v1/login":      {"post": {"summary": "Login (SQLi)"}},
            "/api/v1/users":      {"get":  {"summary": "List users (no auth)"}},
            "/api/v1/users/{id}": {"get":  {"summary": "Get user (IDOR)"}},
            "/api/v1/notes":      {"get":  {"summary": "List notes (broken auth)"}},
            "/api/v1/search":     {"get":  {"summary": "Search (SQLi)"}},
            "/api/v1/exec":       {"post": {"summary": "Execute command (RCE)"}},
            "/api/v1/config":     {"get":  {"summary": "Config (info disclosure)"}},
            "/api/v1/debug":      {"get":  {"summary": "Debug (env dump)"}},
            "/api/v1/fetch":      {"get":  {"summary": "Fetch URL (SSRF)"}},
            "/api/v1/jwt/issue":  {"post": {"summary": "Issue JWT (weak secret)"}},
            "/api/v1/jwt/verify": {"post": {"summary": "Verify JWT (alg:none bypass)"}},
            "/api/v1/render":     {"get":  {"summary": "Render template (SSTI)"}},
            "/latest/meta-data/": {"get":  {"summary": "Fake AWS IMDS"}},
        },
        "components": {
            "securitySchemes": {
                "apiKey": {"type": "apiKey", "in": "header", "name": "X-API-Key"}
            }
        }
    })

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=int(os.environ.get('FLASK_PORT', 9090)), debug=True)
