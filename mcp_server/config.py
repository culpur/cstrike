# cstrike/mcp_server/config.py

import json
from pathlib import Path

_config = None
_config_path = None


def load_config(config_path=None):
    """Load CStrike .env JSON config."""
    global _config, _config_path

    if config_path is None:
        config_path = Path(__file__).parent.parent / ".env"
    else:
        config_path = Path(config_path)

    _config_path = config_path

    if config_path.exists():
        _config = json.loads(config_path.read_text())
    else:
        _config = {}

    return _config


def get_config():
    """Return cached config, loading if needed."""
    if _config is None:
        load_config()
    return _config


def get_config_masked():
    """Return config with sensitive fields masked."""
    cfg = dict(get_config())
    sensitive_keys = [
        "openai_api_key", "msf_password", "anthropic_api_key", "grok_api_key",
        "msf_host", "msf_user", "shodan_api_key", "zap_api_key",
    ]
    for key in sensitive_keys:
        if key in cfg and cfg[key]:
            val = str(cfg[key])
            cfg[key] = val[:4] + "****" if len(val) > 4 else "****"
    return cfg
