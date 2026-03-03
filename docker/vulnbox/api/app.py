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
  - Mass assignment via /api/v1/register           (#11)
  - SSRF via /api/v1/webhook                       (#12)
  - GraphQL introspection via /api/v1/graphql      (#13)
  - Info disclosure via /api/v1/metrics            (#14)
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
            "POST /api/v1/register               [Mass Assignment]",
            "GET  /api/v1/notes",
            "POST /api/v1/exec",
            "GET  /api/v1/config",
            "GET  /api/v1/debug",
            "GET  /api/v1/metrics                 [Info Disclosure]",
            "GET  /api/v1/fetch?url=<url>         [SSRF]",
            "POST /api/v1/webhook                 [SSRF]",
            "POST /api/v1/jwt/issue               [JWT - weak secret]",
            "POST /api/v1/jwt/verify              [JWT - alg:none bypass]",
            "GET  /api/v1/render?template=<tpl>   [SSTI]",
            "POST /api/v1/graphql                 [GraphQL Introspection]",
            "GET  /latest/meta-data/              [Fake IMDS]",
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

# ── Vuln #11: Mass Assignment — user registration with role injection ────────
@app.route('/api/v1/register', methods=['POST'])
def register():
    """
    Mass assignment vulnerability — accepts any field including 'role' and 'api_key'.
    Normal users should only set username/password, but the endpoint blindly accepts all fields.

    Exploit: POST {"username": "hacker", "password": "hacker", "role": "admin", "api_key": "my-key"}
    """
    data = request.get_json() or {}
    username = data.get('username', '')
    password = data.get('password', '')
    if not username or not password:
        return jsonify({"error": "username and password required"}), 400

    # Vuln: All fields from request are used, including role and api_key
    role = data.get('role', 'user')  # Should always be 'user', but attacker can override
    api_key = data.get('api_key', f"vuln-api-key-{username}-{int(time.time())}")

    db = get_db()
    try:
        db.execute(
            "INSERT INTO api_users (username, password, role, api_key) VALUES (?, ?, ?, ?)",
            (username, password, role, api_key)
        )
        db.commit()
        return jsonify({
            "success": True,
            "user": {"username": username, "role": role, "api_key": api_key},
            "note": "Try setting role=admin in the request body"
        }), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "Username already exists"}), 409
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── Vuln #12: Webhook SSRF — server-side callback ───────────────────────────
@app.route('/api/v1/webhook', methods=['POST'])
def webhook():
    """
    SSRF via webhook callback — fetches arbitrary URL server-side.
    POST {"url": "http://169.254.169.254/latest/meta-data/", "event": "test"}

    Unlike /fetch, this simulates a "legitimate" webhook feature that an app might have.
    """
    data = request.get_json() or {}
    callback_url = data.get('url', '')
    event = data.get('event', 'ping')
    payload = data.get('payload', {})

    if not callback_url:
        return jsonify({
            "error": "url required",
            "example": {"url": "http://internal-service:8080/callback", "event": "user.created", "payload": {"user_id": 1}}
        }), 400

    # Vuln: No URL validation, fetches arbitrary URLs including internal services
    webhook_payload = json.dumps({"event": event, "data": payload, "timestamp": int(time.time())})

    if REQUESTS_AVAILABLE:
        try:
            resp = http_requests.post(
                callback_url,
                data=webhook_payload,
                headers={"Content-Type": "application/json", "User-Agent": "VulnBox-Webhook/1.0"},
                timeout=10,
                verify=False,
                allow_redirects=True,
            )
            return jsonify({
                "success": True,
                "callback_url": callback_url,
                "status_code": resp.status_code,
                "response": resp.text[:4096],
            })
        except Exception as e:
            return jsonify({"error": str(e), "callback_url": callback_url}), 500
    else:
        try:
            result = subprocess.run(
                ['curl', '-s', '-X', 'POST', '-H', 'Content-Type: application/json',
                 '-d', webhook_payload, '--max-time', '10', callback_url],
                capture_output=True, text=True, timeout=15
            )
            return jsonify({"success": True, "callback_url": callback_url, "response": result.stdout})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

# ── Vuln #13: GraphQL — introspection enabled ───────────────────────────────
_GRAPHQL_SCHEMA = {
    "queryType": {"name": "Query"},
    "mutationType": {"name": "Mutation"},
    "types": [
        {
            "kind": "OBJECT", "name": "Query",
            "fields": [
                {"name": "users", "description": "List all users (no auth required)", "type": {"name": "[User]"}},
                {"name": "user", "description": "Get user by ID (IDOR)", "args": [{"name": "id", "type": "Int"}], "type": {"name": "User"}},
                {"name": "notes", "description": "All notes including private", "type": {"name": "[Note]"}},
                {"name": "config", "description": "Application configuration (secrets)", "type": {"name": "Config"}},
                {"name": "systemInfo", "description": "Server system information", "type": {"name": "SystemInfo"}},
                {"name": "internalServices", "description": "Internal service endpoints", "type": {"name": "[Service]"}},
            ]
        },
        {
            "kind": "OBJECT", "name": "Mutation",
            "fields": [
                {"name": "login", "description": "Authenticate (SQLi possible)", "args": [{"name": "username"}, {"name": "password"}]},
                {"name": "createUser", "description": "Create user (mass assignment)", "args": [{"name": "input", "type": "UserInput"}]},
                {"name": "executeCommand", "description": "Run shell command (RCE)", "args": [{"name": "cmd", "type": "String"}]},
                {"name": "deleteUser", "description": "Delete any user (no auth)", "args": [{"name": "id", "type": "Int"}]},
            ]
        },
        {
            "kind": "OBJECT", "name": "User",
            "fields": [
                {"name": "id", "type": {"name": "Int"}},
                {"name": "username", "type": {"name": "String"}},
                {"name": "password", "type": {"name": "String"}},
                {"name": "role", "type": {"name": "String"}},
                {"name": "api_key", "type": {"name": "String"}},
                {"name": "ssn", "type": {"name": "String"}},
            ]
        },
        {
            "kind": "OBJECT", "name": "Config",
            "fields": [
                {"name": "database_url", "type": {"name": "String"}},
                {"name": "jwt_secret", "type": {"name": "String"}},
                {"name": "api_secret", "type": {"name": "String"}},
                {"name": "aws_credentials", "type": {"name": "AWSCreds"}},
            ]
        },
        {
            "kind": "OBJECT", "name": "Service",
            "fields": [
                {"name": "name", "type": {"name": "String"}},
                {"name": "host", "type": {"name": "String"}},
                {"name": "port", "type": {"name": "Int"}},
                {"name": "credentials", "type": {"name": "String"}},
            ]
        },
    ]
}

@app.route('/api/v1/graphql', methods=['GET', 'POST'])
def graphql_endpoint():
    """
    Fake GraphQL endpoint with introspection enabled.
    Vuln: Exposes full schema including sensitive types and fields.

    POST {"query": "{ __schema { types { name fields { name } } } }"}
    or GET ?query={__schema{types{name}}}
    """
    if request.method == 'GET':
        query = request.args.get('query', '')
    else:
        data = request.get_json() or {}
        query = data.get('query', '')

    if not query:
        return jsonify({
            "error": "query required",
            "example": '{"query": "{ __schema { types { name fields { name } } } }"}',
            "hint": "Introspection is enabled — query __schema to discover all types and fields"
        }), 400

    # Handle introspection queries
    if '__schema' in query or '__type' in query:
        return jsonify({
            "data": {
                "__schema": _GRAPHQL_SCHEMA,
            }
        })

    # Handle basic user queries
    if 'users' in query.lower():
        db = get_db()
        users = db.execute("SELECT * FROM api_users").fetchall()
        return jsonify({"data": {"users": [dict(u) for u in users]}})

    if 'config' in query.lower():
        return jsonify({
            "data": {
                "config": {
                    "database_url": f"sqlite:///{DB_PATH}",
                    "jwt_secret": JWT_SECRET,
                    "api_secret": API_SECRET,
                    "aws_credentials": {
                        "access_key": "AKIAIOSFODNN7EXAMPLE",
                        "secret_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                    }
                }
            }
        })

    if 'internalservices' in query.lower() or 'internal' in query.lower():
        return jsonify({
            "data": {
                "internalServices": [
                    {"name": "database", "host": "127.0.0.1", "port": 3306, "credentials": "root:root"},
                    {"name": "redis", "host": "127.0.0.1", "port": 6379, "credentials": "no auth"},
                    {"name": "ldap", "host": "127.0.0.1", "port": 389, "credentials": "cn=admin,dc=vulnbox,dc=local:admin"},
                    {"name": "smtp", "host": "127.0.0.1", "port": 25, "credentials": "open relay"},
                    {"name": "dns", "host": "127.0.0.1", "port": 53, "credentials": "open resolver"},
                    {"name": "ftp", "host": "127.0.0.1", "port": 21, "credentials": "anonymous"},
                ]
            }
        })

    return jsonify({"data": None, "errors": [{"message": f"Cannot resolve query: {query}"}]})

# ── Vuln #14: Metrics endpoint — info disclosure ────────────────────────────
@app.route('/api/v1/metrics')
def metrics():
    """
    Prometheus-style metrics endpoint — leaks system info, user counts, secrets.
    No authentication required.
    """
    db = get_db()
    user_count = db.execute("SELECT COUNT(*) FROM api_users").fetchone()[0]
    admin_count = db.execute("SELECT COUNT(*) FROM api_users WHERE role='admin'").fetchone()[0]
    note_count = db.execute("SELECT COUNT(*) FROM api_notes").fetchone()[0]

    uptime = subprocess.getoutput("cat /proc/uptime 2>/dev/null || echo '0 0'").split()[0]
    load_avg = subprocess.getoutput("cat /proc/loadavg 2>/dev/null || echo '0 0 0'")
    mem_info = subprocess.getoutput("free -m 2>/dev/null | head -2 || echo 'N/A'")

    metrics_text = f"""# HELP vulnbox_users_total Total number of registered users
# TYPE vulnbox_users_total gauge
vulnbox_users_total {user_count}

# HELP vulnbox_admins_total Total number of admin users
# TYPE vulnbox_admins_total gauge
vulnbox_admins_total {admin_count}

# HELP vulnbox_notes_total Total number of notes
# TYPE vulnbox_notes_total gauge
vulnbox_notes_total {note_count}

# HELP vulnbox_uptime_seconds System uptime in seconds
# TYPE vulnbox_uptime_seconds gauge
vulnbox_uptime_seconds {uptime}

# HELP vulnbox_load_average System load average
# TYPE vulnbox_load_average gauge
vulnbox_load_average {load_avg}

# HELP vulnbox_info Application info
# TYPE vulnbox_info gauge
vulnbox_info{{version="2.0.0",jwt_secret="{JWT_SECRET}",api_secret="{API_SECRET}",db_path="{DB_PATH}"}} 1

# HELP vulnbox_service_status Internal service status
# TYPE vulnbox_service_status gauge
vulnbox_service_status{{service="mysql",port="3306"}} 1
vulnbox_service_status{{service="redis",port="6379"}} 1
vulnbox_service_status{{service="ssh",port="22"}} 1
vulnbox_service_status{{service="ftp",port="21"}} 1
vulnbox_service_status{{service="smtp",port="25"}} 1
vulnbox_service_status{{service="dns",port="53"}} 1
vulnbox_service_status{{service="ldap",port="389"}} 1
vulnbox_service_status{{service="smb",port="445"}} 1
vulnbox_service_status{{service="snmp",port="161"}} 1
vulnbox_service_status{{service="http",port="80"}} 1
vulnbox_service_status{{service="https",port="443"}} 1
vulnbox_service_status{{service="api",port="9090"}} 1

# HELP vulnbox_memory_usage Memory info
# TYPE vulnbox_memory_usage gauge
# {mem_info}
"""
    return metrics_text, 200, {'Content-Type': 'text/plain; charset=utf-8'}

# ── OpenAPI spec ──────────────────────────────────────────────────────────────
@app.route('/swagger.json')
@app.route('/openapi.json')
def openapi_spec():
    return jsonify({
        "openapi": "3.0.0",
        "info": {"title": "VulnBox API", "version": "2.0.0"},
        "paths": {
            "/api/v1/login":      {"post": {"summary": "Login (SQLi)"}},
            "/api/v1/register":   {"post": {"summary": "Register (Mass Assignment)"}},
            "/api/v1/users":      {"get":  {"summary": "List users (no auth)"}},
            "/api/v1/users/{id}": {"get":  {"summary": "Get user (IDOR)"}},
            "/api/v1/notes":      {"get":  {"summary": "List notes (broken auth)"}},
            "/api/v1/search":     {"get":  {"summary": "Search (SQLi)"}},
            "/api/v1/exec":       {"post": {"summary": "Execute command (RCE)"}},
            "/api/v1/config":     {"get":  {"summary": "Config (info disclosure)"}},
            "/api/v1/debug":      {"get":  {"summary": "Debug (env dump)"}},
            "/api/v1/metrics":    {"get":  {"summary": "Metrics (info disclosure)"}},
            "/api/v1/fetch":      {"get":  {"summary": "Fetch URL (SSRF)"}},
            "/api/v1/webhook":    {"post": {"summary": "Webhook callback (SSRF)"}},
            "/api/v1/jwt/issue":  {"post": {"summary": "Issue JWT (weak secret)"}},
            "/api/v1/jwt/verify": {"post": {"summary": "Verify JWT (alg:none bypass)"}},
            "/api/v1/render":     {"get":  {"summary": "Render template (SSTI)"}},
            "/api/v1/graphql":    {"post": {"summary": "GraphQL (introspection)"}},
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
