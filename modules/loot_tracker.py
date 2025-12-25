# /opt/ai_driver/modules/loot_tracker.py

import json
import re
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timezone

LOOT_FILE = "loot.json"
CREDENTIALS_FILE = "credentials.json"

# Service criticality weights
SERVICE_WEIGHTS = {
    'ssh': 10,
    'rdp': 10,
    'ftp': 8,
    'smb': 8,
    'telnet': 9,
    'mysql': 7,
    'postgres': 7,
    'mssql': 7,
    'mongodb': 6,
    'redis': 6,
    'vnc': 8,
    'http': 5,
    'https': 5,
    'default': 3
}

# Common high-value usernames
HIGH_VALUE_USERNAMES = {
    'root': 10,
    'admin': 9,
    'administrator': 9,
    'sa': 8,
    'postgres': 7,
    'mysql': 7,
    'system': 8,
    'sysadmin': 8,
    'superuser': 8,
    'wheel': 7,
    'sudo': 7,
    'operator': 6,
    'service': 5,
    'user': 2
}

def _get_loot_path(target):
    return Path("results") / target / LOOT_FILE

def _get_credentials_path(target):
    return Path("results") / target / CREDENTIALS_FILE

def _load_loot(target):
    path = _get_loot_path(target)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}

def _save_loot(target, loot):
    path = _get_loot_path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(loot, indent=2))

def _load_credentials(target):
    """Load credentials with validation metadata"""
    path = _get_credentials_path(target)
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text())
    except Exception:
        return []

def _save_credentials(target, credentials):
    """Save credentials with validation metadata"""
    path = _get_credentials_path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(credentials, indent=2))

def add_loot(target, category, value):
    loot = _load_loot(target)
    if category not in loot:
        loot[category] = []
    if value not in loot[category]:
        loot[category].append(value)
        _save_loot(target, loot)

def get_loot(target, category):
    loot = _load_loot(target)
    return loot.get(category, [])


def _calculate_password_complexity(password):
    """
    Calculate password complexity score (lower = weaker = higher priority to test)
    Returns score from 0-20 where:
    - 0-5: Very weak (high priority)
    - 6-10: Weak (medium priority)
    - 11-15: Medium (low priority)
    - 16+: Strong (very low priority)
    """
    if not password:
        return 0

    score = 0

    # Length factor
    length = len(password)
    if length >= 12:
        score += 6
    elif length >= 8:
        score += 3
    elif length >= 6:
        score += 1

    # Character diversity
    if re.search(r'[a-z]', password):
        score += 2
    if re.search(r'[A-Z]', password):
        score += 3
    if re.search(r'[0-9]', password):
        score += 2
    if re.search(r'[^a-zA-Z0-9]', password):
        score += 4

    # Common patterns (reduce complexity score)
    common_patterns = [
        r'123456', r'password', r'qwerty', r'admin', r'letmein',
        r'welcome', r'monkey', r'dragon', r'master', r'shadow'
    ]
    for pattern in common_patterns:
        if re.search(pattern, password.lower()):
            score = max(0, score - 5)
            break

    # Repeating characters
    if re.search(r'(.)\1{2,}', password):
        score = max(0, score - 2)

    return min(score, 20)


def _get_username_weight(username):
    """Get weight for username based on common high-value accounts"""
    username_lower = username.lower()

    # Check exact matches first
    if username_lower in HIGH_VALUE_USERNAMES:
        return HIGH_VALUE_USERNAMES[username_lower]

    # Check partial matches
    for key, weight in HIGH_VALUE_USERNAMES.items():
        if key in username_lower:
            return weight

    return 1  # Default weight


def _get_service_weight(service):
    """Get criticality weight for service"""
    service_lower = service.lower() if service else 'default'

    for key, weight in SERVICE_WEIGHTS.items():
        if key in service_lower:
            return weight

    return SERVICE_WEIGHTS['default']


def _load_all_loot():
    """Load loot from all targets"""
    results_dir = Path("results")
    all_loot = defaultdict(lambda: defaultdict(list))

    if not results_dir.exists():
        return all_loot

    for target_dir in results_dir.iterdir():
        if target_dir.is_dir():
            target = target_dir.name
            loot = _load_loot(target)

            for category, items in loot.items():
                all_loot[target][category] = items

    return all_loot


def score_credential(username, password, service='default', target='', all_loot=None):
    """
    Score a credential pair based on multiple factors.

    Scoring formula:
    score = (reuse_count * 10) + username_weight + service_weight - (complexity_score / 2)

    Higher score = higher priority to test

    Args:
        username: Username string
        password: Password string
        service: Service type (ssh, rdp, http, etc.)
        target: Target host
        all_loot: Pre-loaded loot data (optional, for performance)

    Returns:
        dict with score and breakdown
    """
    if all_loot is None:
        all_loot = _load_all_loot()

    # Calculate reuse count (how many targets have this credential)
    reuse_count = 0
    for target_loot in all_loot.values():
        usernames = target_loot.get('username', [])
        passwords = target_loot.get('password', [])
        if username in usernames or password in passwords:
            reuse_count += 1

    # Get individual factors
    username_weight = _get_username_weight(username)
    service_weight = _get_service_weight(service)
    complexity_score = _calculate_password_complexity(password)

    # Calculate final score
    # Higher reuse = much higher priority (credential reuse is critical)
    # High-value usernames = higher priority
    # Critical services = higher priority
    # Weak passwords = higher priority (subtract complexity/2 so weak passwords increase score)
    score = (reuse_count * 10) + username_weight + service_weight - (complexity_score / 2)

    return {
        'score': round(score, 2),
        'breakdown': {
            'reuse_count': reuse_count,
            'reuse_score': reuse_count * 10,
            'username_weight': username_weight,
            'service_weight': service_weight,
            'complexity_score': complexity_score,
            'complexity_penalty': round(complexity_score / 2, 2)
        }
    }


def generate_credential_heatmap(limit=50):
    """
    Generate a heatmap of all credentials across all targets, scored by priority.

    Returns top N credentials sorted by score (highest priority first).

    Args:
        limit: Maximum number of credentials to return (default: 50)

    Returns:
        list of dicts containing credential info and scoring
    """
    all_loot = _load_all_loot()
    credentials = []

    # Collect all username/password pairs from all targets
    for target, loot in all_loot.items():
        usernames = loot.get('username', [])
        passwords = loot.get('password', [])

        # Get service info from ports if available
        ports = loot.get('port', [])
        services = []

        for port in ports:
            # Infer service from common ports
            port_num = int(port) if isinstance(port, (int, str)) and str(port).isdigit() else 0
            service_map = {
                22: 'ssh',
                21: 'ftp',
                23: 'telnet',
                3389: 'rdp',
                445: 'smb',
                139: 'smb',
                3306: 'mysql',
                5432: 'postgres',
                1433: 'mssql',
                27017: 'mongodb',
                6379: 'redis',
                5900: 'vnc',
                80: 'http',
                443: 'https'
            }
            if port_num in service_map:
                services.append(service_map[port_num])

        # If no services detected, use default
        if not services:
            services = ['default']

        # Create credential pairs (cartesian product of usernames x passwords x services)
        for username in usernames:
            for password in passwords:
                for service in services:
                    scoring = score_credential(username, password, service, target, all_loot)

                    credentials.append({
                        'username': username,
                        'password': password,
                        'service': service,
                        'target': target,
                        'score': scoring['score'],
                        'breakdown': scoring['breakdown']
                    })

    # Sort by score (highest first) and return top N
    sorted_creds = sorted(credentials, key=lambda x: x['score'], reverse=True)
    return sorted_creds[:limit]


def add_credential(target, username, password, source, service='ssh', port=None):
    """
    Add a credential with metadata for validation

    Args:
        target: Target host
        username: Username
        password: Password
        source: Where the credential was discovered
        service: Service type (ssh, http, ftp, etc.)
        port: Optional port number

    Returns:
        Dictionary with the created credential including ID
    """
    credentials = _load_credentials(target)

    credential = {
        'id': f"cred_{len(credentials)}_{datetime.now().timestamp()}",
        'target': target,
        'username': username,
        'password': password,
        'source': source,
        'service': service,
        'port': port,
        'validated': False,
        'validation_result': None,
        'created_at': datetime.now(timezone.utc).isoformat(),
        'tested_at': None
    }

    credentials.append(credential)
    _save_credentials(target, credentials)

    return credential


def get_credentials(target):
    """Get all credentials for a target"""
    return _load_credentials(target)


def get_all_credentials():
    """Get all credentials from all targets"""
    results_dir = Path("results")
    all_credentials = []

    if not results_dir.exists():
        return all_credentials

    for target_dir in results_dir.iterdir():
        if target_dir.is_dir():
            credentials = _load_credentials(target_dir.name)
            all_credentials.extend(credentials)

    return all_credentials


def get_credential_by_id(credential_id):
    """Find a credential by ID across all targets"""
    results_dir = Path("results")
    if not results_dir.exists():
        return None

    for target_dir in results_dir.iterdir():
        if target_dir.is_dir():
            credentials = _load_credentials(target_dir.name)
            for cred in credentials:
                if cred.get('id') == credential_id:
                    return cred

    return None


def update_credential_validation(credential_id, validation_result):
    """
    Update credential with validation result

    Args:
        credential_id: Credential ID
        validation_result: Dictionary with validation result including:
                          valid, service, tested_at, error, details

    Returns:
        Updated credential or None if not found
    """
    results_dir = Path("results")
    if not results_dir.exists():
        return None

    for target_dir in results_dir.iterdir():
        if target_dir.is_dir():
            target = target_dir.name
            credentials = _load_credentials(target)

            for i, cred in enumerate(credentials):
                if cred.get('id') == credential_id:
                    # Update credential with validation result
                    credentials[i]['validated'] = validation_result.get('valid', False)
                    credentials[i]['validation_result'] = validation_result
                    credentials[i]['tested_at'] = validation_result.get('tested_at')

                    _save_credentials(target, credentials)
                    return credentials[i]

    return None

