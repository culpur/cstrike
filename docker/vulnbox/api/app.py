#!/usr/bin/env python3
"""VulnBox REST API - Deliberately Vulnerable Flask API"""
import os, subprocess, sqlite3, json
from functools import wraps
from flask import Flask, request, jsonify, g
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

API_SECRET = "master-key-do-not-share-98765"
ADMIN_TOKEN = "admin-token-super-secret-12345"
DB_PATH = "/opt/vulnapi/api.db"

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db: db.close()

def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute('CREATE TABLE IF NOT EXISTS api_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT "user", api_key TEXT)')
    db.execute('CREATE TABLE IF NOT EXISTS api_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, content TEXT, private INTEGER DEFAULT 0)')
    try:
        db.execute("INSERT INTO api_users (username, password, role, api_key) VALUES (?, ?, ?, ?)", ("admin", "admin123", "admin", "vuln-api-key-admin-00001"))
        db.execute("INSERT INTO api_users (username, password, role, api_key) VALUES (?, ?, ?, ?)", ("user", "user123", "user", "vuln-api-key-user-00002"))
        db.execute("INSERT INTO api_users (username, password, role, api_key) VALUES (?, ?, ?, ?)", ("service", "service", "service", "vuln-api-key-svc-00003"))
        db.execute("INSERT INTO api_notes (user_id, title, content, private) VALUES (1, 'SSH Keys', 'Root key at /root/.ssh/id_rsa', 1)")
        db.execute("INSERT INTO api_notes (user_id, title, content, private) VALUES (1, 'Deploy Creds', 'deploy:deploy on all servers', 1)")
        db.execute("INSERT INTO api_notes (user_id, title, content, private) VALUES (2, 'Public Note', 'This is a public note', 0)")
        db.commit()
    except sqlite3.IntegrityError:
        pass
    db.close()

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        api_key = request.headers.get('X-API-Key') or request.args.get('api_key')
        if not api_key: return jsonify({"error": "API key required"}), 401
        db = get_db()
        user = db.execute("SELECT * FROM api_users WHERE api_key = ?", (api_key,)).fetchone()
        if not user: return jsonify({"error": "Invalid API key"}), 401
        g.current_user = dict(user)
        return f(*args, **kwargs)
    return decorated

@app.route('/')
def index():
    return jsonify({"service": "VulnBox API", "version": "1.0.0",
        "endpoints": ["GET /api/v1/users", "POST /api/v1/login", "GET /api/v1/notes", "POST /api/v1/exec", "GET /api/v1/config", "GET /api/v1/debug"],
        "auth": "X-API-Key header", "debug": True})

@app.route('/api/v1/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    username = data.get('username', '')
    password = data.get('password', '')
    db = get_db()
    query = f"SELECT * FROM api_users WHERE username = '{username}' AND password = '{password}'"
    try:
        user = db.execute(query).fetchone()
        if user: return jsonify({"success": True, "user": dict(user), "token": ADMIN_TOKEN if user['role'] == 'admin' else "user-token"})
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
    user = db.execute("SELECT * FROM api_users WHERE id = ?", (user_id,)).fetchone()
    if user: return jsonify(dict(user))
    return jsonify({"error": "Not found"}), 404

@app.route('/api/v1/notes')
@require_auth
def list_notes():
    db = get_db()
    notes = db.execute("SELECT * FROM api_notes").fetchall()
    return jsonify({"notes": [dict(n) for n in notes]})

@app.route('/api/v1/notes/<int:note_id>')
def get_note(note_id):
    db = get_db()
    note = db.execute("SELECT * FROM api_notes WHERE id = ?", (note_id,)).fetchone()
    if note: return jsonify(dict(note))
    return jsonify({"error": "Not found"}), 404

@app.route('/api/v1/search')
def search():
    q = request.args.get('q', '')
    db = get_db()
    try:
        results = db.execute(f"SELECT id, username, role FROM api_users WHERE username LIKE '%{q}%'").fetchall()
        return jsonify({"results": [dict(r) for r in results]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/v1/exec', methods=['POST'])
@require_auth
def exec_command():
    data = request.get_json() or {}
    cmd = data.get('cmd', '')
    if not cmd: return jsonify({"error": "cmd required"}), 400
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        return jsonify({"stdout": result.stdout, "stderr": result.stderr, "returncode": result.returncode})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Timed out"}), 408

@app.route('/api/v1/config')
def get_config():
    return jsonify({"database": DB_PATH, "api_secret": API_SECRET, "debug": True,
        "server_info": {"hostname": subprocess.getoutput("hostname"), "kernel": subprocess.getoutput("uname -r")}})

@app.route('/api/v1/debug')
def debug():
    return jsonify({"env": dict(os.environ), "user": subprocess.getoutput("whoami"), "id": subprocess.getoutput("id")})

@app.route('/api/v1/health')
def health():
    return jsonify({"status": "healthy", "service": "vulnbox-api"})

@app.route('/swagger.json')
@app.route('/openapi.json')
def openapi_spec():
    return jsonify({"openapi": "3.0.0", "info": {"title": "VulnBox API", "version": "1.0.0"},
        "paths": {
            "/api/v1/login": {"post": {"summary": "Login", "requestBody": {"content": {"application/json": {"schema": {"type": "object", "properties": {"username": {"type": "string"}, "password": {"type": "string"}}}}}}}},
            "/api/v1/users": {"get": {"summary": "List users"}},
            "/api/v1/users/{id}": {"get": {"summary": "Get user", "parameters": [{"name": "id", "in": "path", "schema": {"type": "integer"}}]}},
            "/api/v1/notes": {"get": {"summary": "List notes", "security": [{"apiKey": []}]}},
            "/api/v1/search": {"get": {"summary": "Search", "parameters": [{"name": "q", "in": "query", "schema": {"type": "string"}}]}},
            "/api/v1/exec": {"post": {"summary": "Execute command", "security": [{"apiKey": []}]}},
            "/api/v1/config": {"get": {"summary": "Config"}},
            "/api/v1/debug": {"get": {"summary": "Debug"}},
        },
        "components": {"securitySchemes": {"apiKey": {"type": "apiKey", "in": "header", "name": "X-API-Key"}}}})

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=int(os.environ.get('FLASK_PORT', 9090)), debug=True)
