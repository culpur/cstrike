"""CStrike configuration loader and validator.

Loads the .env JSON file, validates required fields, and returns
a typed config dict. Fails fast with clear error messages.
"""

import json
import sys
from pathlib import Path


# Fields that must exist and be non-empty
REQUIRED_FIELDS = {
    "target_scope": list,
    "scan_modes": list,
    "allowed_tools": list,
}

# Fields with defaults
DEFAULTS = {
    "allow_exploitation": False,
    "max_runtime": 300,
    "max_threads": 10,
    "ai_provider": "ollama",
    "ollama_model": "qwen3",
    "ollama_host": "http://localhost:11434",
    "openai_api_key": "",
    "openai_model": "gpt-5.2",
    "anthropic_api_key": "",
    "anthropic_model": "claude-sonnet-4-6",
    "grok_api_key": "",
    "grok_model": "grok-3",
    "ai_max_tokens": 800,
    "ai_temperature": 0.3,
    "ai_max_iterations": 15,
    "mcp_enabled": False,
    "msf_username": "msf",
    "msf_password": "",
    "msf_host": "127.0.0.1",
    "msf_port": 55552,
    "zap_host": "127.0.0.1",
    "zap_port": 8090,
}

# AI provider → required key field
AI_KEY_MAP = {
    "openai": "openai_api_key",
    "anthropic": "anthropic_api_key",
    "grok": "grok_api_key",
}


class ConfigError(Exception):
    """Raised when config validation fails."""


def load_config(config_path: str = ".env") -> dict:
    """Load and validate the .env JSON config file.

    Args:
        config_path: Path to the JSON config file.

    Returns:
        Validated config dict with defaults applied.

    Raises:
        ConfigError: If the file is missing, unparseable, or invalid.
    """
    path = Path(config_path)

    if not path.exists():
        raise ConfigError(
            f"Config file not found: {path.resolve()}\n"
            f"Copy .env.example to .env and configure your targets."
        )

    try:
        raw = path.read_text()
    except OSError as e:
        raise ConfigError(f"Cannot read config file: {e}")

    try:
        config = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ConfigError(f"Invalid JSON in {config_path}: {e}")

    if not isinstance(config, dict):
        raise ConfigError(f"Config must be a JSON object, got {type(config).__name__}")

    errors = []

    # Check required fields
    for field, expected_type in REQUIRED_FIELDS.items():
        if field not in config:
            errors.append(f"Missing required field: {field}")
        elif not isinstance(config[field], expected_type):
            errors.append(
                f"Field '{field}' must be {expected_type.__name__}, "
                f"got {type(config[field]).__name__}"
            )
        elif expected_type is list and len(config[field]) == 0:
            errors.append(f"Field '{field}' cannot be empty")

    # Apply defaults for optional fields
    for field, default in DEFAULTS.items():
        config.setdefault(field, default)

    # Validate AI provider key (skip for ollama which is local)
    provider = config.get("ai_provider", "ollama")
    if provider in AI_KEY_MAP:
        key_field = AI_KEY_MAP[provider]
        if not config.get(key_field):
            errors.append(
                f"AI provider '{provider}' requires '{key_field}' to be set"
            )

    if errors:
        msg = "Configuration errors:\n" + "\n".join(f"  - {e}" for e in errors)
        raise ConfigError(msg)

    return config


def validate_or_exit(config_path: str = ".env") -> dict:
    """Load config or print errors and exit."""
    try:
        return load_config(config_path)
    except ConfigError as e:
        print(f"\n[!] {e}\n", file=sys.stderr)
        sys.exit(1)
