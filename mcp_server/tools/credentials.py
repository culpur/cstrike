# cstrike/mcp_server/tools/credentials.py — Credential management MCP tools

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


def register(mcp, guardrails):

    @mcp.tool()
    async def add_credential(target: str, username: str, password: str,
                             source: str, service: str = "ssh", port: int = 0) -> str:
        """Add a discovered credential to the credential store. source: where this credential was found (e.g. hydra, nikto)."""
        guardrails.enforce("cstrike-credentials", target)

        from modules.loot_tracker import add_credential as _add
        port_val = port if port else None
        cred = await asyncio.to_thread(_add, target, username, password, source, service, port_val)
        return json.dumps({"status": "added", "credential": cred})

    @mcp.tool()
    async def validate_credential(credential_id: str, target: str, username: str,
                                  password: str, service: str, port: int = 0) -> str:
        """Validate a credential by attempting to authenticate against the target service. service: ssh, ftp, http, rdp, smb."""
        guardrails.enforce("cstrike-credentials", target)
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled — credential validation requires allow_exploitation."})

        from modules.credential_validator import CredentialValidator
        validator = CredentialValidator()
        port_val = port if port else None
        result = await asyncio.to_thread(validator.validate, credential_id, target, username, password, service, port_val)
        return json.dumps(result)

    @mcp.tool()
    async def validate_credentials_batch(credentials_json: str) -> str:
        """Validate multiple credentials in batch. credentials_json: JSON array of {credential_id, target, username, password, service, port} objects."""
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled — credential validation requires allow_exploitation."})

        from modules.credential_validator import validate_credentials_batch as _batch
        creds = json.loads(credentials_json) if isinstance(credentials_json, str) else credentials_json

        # Enforce scope on each target in the batch
        for cred in creds:
            t = cred.get("target", "")
            if t:
                guardrails.enforce("cstrike-credentials", t)

        results = await asyncio.to_thread(_batch, creds)
        return json.dumps({"results": results, "total": len(results)})

    @mcp.tool()
    async def score_credential(username: str, password: str,
                               service: str = "default", target: str = "") -> str:
        """Score a credential's priority based on username sensitivity, service value, password complexity, and reuse count. Higher scores indicate higher-value targets."""
        guardrails.enforce("cstrike-credentials", target or "localhost")

        from modules.loot_tracker import score_credential as _score
        result = await asyncio.to_thread(_score, username, password, service, target)
        return json.dumps(result)

    @mcp.tool()
    async def get_credential_heatmap(limit: int = 50) -> str:
        """Generate a credential priority heatmap showing the highest-value username/password/service combinations to target. Returns scored and sorted credentials."""
        guardrails.enforce("cstrike-credentials", "localhost")

        from modules.loot_tracker import generate_credential_heatmap as _heatmap
        results = await asyncio.to_thread(_heatmap, limit)
        return json.dumps({"heatmap": results, "count": len(results)})
