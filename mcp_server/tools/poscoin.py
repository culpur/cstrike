# cstrike/mcp_server/tools/poscoin.py — pos-coin Wallet Drainer Detection & Exploitation
#
# Targeted toolset for identifying, fingerprinting, and exploiting deployments
# of the "pos-coin" crypto wallet drainer kit used by the qsjt/QWDB operation.
#
# Capabilities:
#   - poscoin_scan: Fingerprint a URL/file for pos-coin drainer signatures
#   - poscoin_extract_config: Pull drain wallet, Crisp ID, Telegram from live API
#   - poscoin_enumerate_victims: Query blockchain for approved/drained wallets
#   - poscoin_api_probe: Probe all Fishpond/Config/Mining endpoints
#   - poscoin_urlscan_hunt: Search urlscan.io for new pos-coin deployments
#   - poscoin_trace_wallet: Trace a drain wallet's transferFrom history
#
# All tools require authorization context (pentesting/CTF/defensive research).

import asyncio
import json
import os
import re
import sys
import hashlib
from urllib.parse import urlparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from modules.utils import run_command_with_log, save_result, get_target_dir


# ---------------------------------------------------------------------------
# Fingerprint database — invariant signatures from reverse engineering
# ---------------------------------------------------------------------------

POSCOIN_FINGERPRINTS = {
    # API routes (developer naming — requires frontend+backend rewrite to change)
    "api": [
        ("Fishpond/authorizedStatusUpdate", 0.25, "Drain tracking endpoint"),
        ("Fishpond/getUserInfo", 0.15, "Victim registration"),
        ("Fishpond/getDetailedBalance", 0.10, "Fake balance"),
        ("Config/getConfig", 0.08, "C2 config delivery"),
        ("Virtualaddress/getVirtualaddress", 0.12, "Fake social proof"),
        ("Mining/getMining", 0.05, "Fake mining data"),
        ("Activity/activityQuery", 0.05, "Fake events"),
    ],
    # V3 API variant (onchain-* domains)
    "api_v3": [
        ("pool/index/poolconfig", 0.15, "V3 pool config"),
        ("pool/index/walletconfig", 0.20, "V3 drain wallet config"),
        ("pool/index/marketprice", 0.05, "V3 market data"),
    ],
    # Drain mechanism
    "drain": [
        ("0x095ea7b3", 0.08, "approve() function selector"),
        ("fffffffffffffffffffffffffffffffffffffffffff", 0.12, "MAX_UINT approval"),
        ("90000000000000000000000000000", 0.20, "TRC-20 90T approval"),
        ("authorizedAddress", 0.15, "Dynamic drain wallet field"),
    ],
    # Developer fingerprints (typos, unique naming)
    "dev": [
        ("BanlancePledge", 0.25, "Developer typo (Balance)"),
        ("pool-warp", 0.05, "CSS typo (wrap)"),
        ("systemIncomeList", 0.08, "Unique data field"),
        ("pledge_income_ratio", 0.08, "Unique API field"),
        ("incomeExchange", 0.05, "Unique route path"),
    ],
    # i18n keys
    "i18n": [
        ("Apply_for_an_exclusive_mining_pool_node_for_you", 0.15, "Drain trigger i18n"),
        ("Applying_for_a_node_requires_payment_of_miner_fees", 0.20, "Node pitch i18n"),
        ("Short_term_lock_on_USDT_for_higher_rewards", 0.10, "Staking pitch i18n"),
        ("Complete_the_mining_pool_task_to_receive_rewards", 0.10, "Task engagement i18n"),
        ("Daily_profit_ratio_corresponding_to_wallet_balance", 0.10, "Yield display i18n"),
    ],
    # Behavioral
    "behavioral": [
        ("CRISP_WEBSITE_ID", 0.05, "Dynamic Crisp chat"),
        ("tg_service", 0.05, "Dynamic Telegram link"),
        ("pos-coin", 0.15, "Page title / brand"),
    ],
}

# Known token contracts targeted by pos-coin
KNOWN_CONTRACTS = {
    "0xdac17f958d2ee523a2206206994597c13d831ec7": "ETH USDT",
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "ETH USDC",
    "0x55d398326f99059ff775485246999027b3197955": "BSC USDT",
    "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": "Polygon USDT",
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t": "TRC20 USDT",
}

# Known drain wallets (from our research)
KNOWN_DRAIN_WALLETS = {
    "0x7975edd78f0c5a56b96caacefd73f47c858f7adb": "onchain-ethereumdlt.net (V3)",
    "0x8e301b925a607e7bc91f2a18338bcafb69729698": "qsjt66/multi-domain drainer",
}

# Known infrastructure IPs
KNOWN_INFRA_IPS = {
    "34.92.61.37": "Registration funnel (Google Cloud HK, port 36180)",
    "43.162.123.184": "Tencent Cloud (qsjt66)",
    "43.135.144.20": "Tencent Cloud (qsjt30 + gov phishing)",
    "43.153.73.49": "Tencent Cloud (qshz68, ryylfa)",
    "170.106.168.202": "Tencent Cloud (qsjt26)",
    "195.54.171.217": "M247 Romania (cominbaxz.xyz DGA)",
    "208.98.41.39": "SharkTech (onchain-* domains)",
    "156.249.238.230": "AresIDC/Cloud Innovation (qsjt88)",
    "158.247.220.215": "Constant Co Japan (54 QWDB domains)",
}


def _scan_content(content, target_name="<content>"):
    """Scan content against all fingerprint layers. Returns structured result."""
    matches = []
    confidence = 0.0
    layer_scores = {}

    for layer, fingerprints in POSCOIN_FINGERPRINTS.items():
        for pattern, weight, desc in fingerprints:
            if pattern.lower() in content.lower():
                matches.append({
                    "layer": layer, "pattern": pattern,
                    "weight": weight, "description": desc
                })
                confidence += weight
                layer_scores[layer] = layer_scores.get(layer, 0) + weight

    # Extract IOCs
    iocs = {}
    api_urls = re.findall(r'baseURL["\s:]+["\'](https?://[^"\']+/api/)["\']', content)
    if api_urls:
        iocs["api_base_urls"] = list(set(api_urls))

    eth_addrs = set(re.findall(r'0x[a-fA-F0-9]{40}', content))
    known_found = {}
    for addr in eth_addrs:
        norm = addr.lower()
        if norm in KNOWN_CONTRACTS:
            known_found[addr] = KNOWN_CONTRACTS[norm]
        if norm in KNOWN_DRAIN_WALLETS:
            iocs.setdefault("known_drain_wallets", []).append(
                {"address": addr, "attribution": KNOWN_DRAIN_WALLETS[norm]})
    if known_found:
        iocs["token_contracts"] = known_found

    tron_addrs = set(re.findall(r'T[A-Za-z1-9]{33}', content))
    for addr in tron_addrs:
        if addr in KNOWN_CONTRACTS:
            iocs.setdefault("tron_contracts", {})[addr] = KNOWN_CONTRACTS[addr]

    baidu_ids = re.findall(r'hm\.js\?([a-f0-9]{32})', content)
    if baidu_ids:
        iocs["baidu_analytics"] = list(set(baidu_ids))

    confidence = min(confidence, 1.0)
    if confidence >= 0.70:
        verdict = "CONFIRMED pos-coin drainer"
    elif confidence >= 0.45:
        verdict = "HIGH probability pos-coin drainer"
    elif confidence >= 0.25:
        verdict = "SUSPICIOUS — partial match"
    elif confidence >= 0.10:
        verdict = "LOW — minor indicators"
    else:
        verdict = "clean"

    return {
        "target": target_name,
        "confidence": round(confidence, 4),
        "verdict": verdict,
        "matched": len(matches),
        "matches": matches,
        "layer_scores": {k: round(v, 4) for k, v in layer_scores.items()},
        "iocs": iocs,
        "sha256": hashlib.sha256(content.encode("utf-8", "ignore")).hexdigest()[:16],
    }


def register(mcp, guardrails):

    @mcp.tool()
    async def poscoin_scan(target: str, url: str = "", file_path: str = "") -> str:
        """Scan a URL or local file for pos-coin wallet drainer signatures.
        Uses 6-layer fingerprinting (API routes, drain mechanics, i18n keys,
        developer typos, behavioral patterns, component structure).
        Returns confidence score 0-100%, verdict, matched fingerprints, and IOCs.
        Specify url= for a live site, or file_path= for a local JS file."""
        guardrails.enforce("poscoin_scan", target)

        content = ""
        scan_target = url or file_path or target

        if file_path and os.path.exists(file_path):
            with open(file_path, encoding="utf-8", errors="ignore") as f:
                content = f.read()
        elif url or target.startswith("http"):
            fetch_url = url or target
            # Fetch HTML
            cmd = ["curl", "-sL", "--max-time", "15", "-k", fetch_url]
            html = await asyncio.to_thread(
                run_command_with_log, cmd, guardrails.get_timeout())
            content = html

            # Extract and fetch JS bundles
            js_refs = re.findall(r'src="([^"]*\.js[^"]*)"', html)
            parsed = urlparse(fetch_url)
            base = f"{parsed.scheme}://{parsed.netloc}"
            for ref in js_refs:
                if "archive.org" in ref or "cdnjs" in ref:
                    continue
                js_url = ref if ref.startswith("http") else base + (
                    ref if ref.startswith("/") else "/" + ref)
                js_cmd = ["curl", "-sL", "--max-time", "15", "-k", js_url]
                js_content = await asyncio.to_thread(
                    run_command_with_log, js_cmd, guardrails.get_timeout())
                content += "\n" + js_content
        else:
            return json.dumps({"error": "Provide url= or file_path= to scan"})

        result = _scan_content(content, scan_target)
        save_result(target, "poscoin_scan", ["poscoin_scan", scan_target],
                    json.dumps(result))
        return json.dumps(result)

    @mcp.tool()
    async def poscoin_extract_config(target: str, api_url: str) -> str:
        """Extract drain wallet address, Crisp chat ID, and Telegram link from
        a live pos-coin API. Exploits V-001/V-002: zero authentication.
        api_url should be the base URL (e.g., https://site.com/api/).
        Queries Config/getConfig for all 3 chain types plus V3 endpoints."""
        guardrails.enforce("poscoin_extract_config", target)
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled in config."})

        results = {}
        api_url = api_url.rstrip("/")

        # V2 API (Fishpond-style)
        for chain in ["erc", "bsc", "trc"]:
            cmd = ["curl", "-s", "--max-time", "10", "-X", "POST",
                   f"{api_url}/Config/getConfig",
                   "-d", f"chainType={chain}",
                   "-H", "Content-Type: application/x-www-form-urlencoded"]
            output = await asyncio.to_thread(
                run_command_with_log, cmd, guardrails.get_timeout())
            try:
                data = json.loads(output)
                if data.get("code") == 1 or "authorizedAddress" in str(data):
                    results[f"v2_{chain}"] = data
            except json.JSONDecodeError:
                pass

        # V3 API (pool/index-style)
        for endpoint in ["poolconfig", "walletconfig", "marketprice"]:
            cmd = ["curl", "-s", "--max-time", "10",
                   f"{api_url}/pool/index/{endpoint}"]
            output = await asyncio.to_thread(
                run_command_with_log, cmd, guardrails.get_timeout())
            try:
                data = json.loads(output)
                if data.get("code") == 1 or "config" in data:
                    results[f"v3_{endpoint}"] = data
            except json.JSONDecodeError:
                pass

        # Extract key IOCs from results
        iocs = {"drain_wallets": [], "customer_service": [], "infura_keys": []}
        for key, data in results.items():
            data_str = json.dumps(data)
            # Drain wallets
            for pattern in [r'"authorized[_a-z]*":\s*"(0x[a-fA-F0-9]{40})"',
                            r'"authorizedAddress":\s*"(0x[a-fA-F0-9]{40})"']:
                for match in re.findall(pattern, data_str):
                    if match not in iocs["drain_wallets"]:
                        iocs["drain_wallets"].append(match)
            # Crisp
            for match in re.findall(r'"customerService":\s*"([^"]+)"', data_str):
                if match not in iocs["customer_service"]:
                    iocs["customer_service"].append(match)
            # Telegram
            for match in re.findall(r'"tg_service":\s*"([^"]+)"', data_str):
                if match not in iocs["customer_service"]:
                    iocs["customer_service"].append(match)
            # Infura
            for match in re.findall(r'"infura_key":\s*"([^"]+)"', data_str):
                if match not in iocs["infura_keys"]:
                    iocs["infura_keys"].append(match)
            # Customer service URL
            for match in re.findall(r'"kf_url":\s*"([^"]+)"', data_str):
                if match not in iocs["customer_service"]:
                    iocs["customer_service"].append(match)

        result = {
            "target": target,
            "api_url": api_url,
            "api_responses": results,
            "extracted_iocs": iocs,
            "versions_detected": [
                k.split("_")[0] for k in results.keys()
            ],
        }
        save_result(target, "poscoin_extract_config",
                    ["poscoin_extract_config", api_url], json.dumps(result))
        return json.dumps(result)

    @mcp.tool()
    async def poscoin_api_probe(target: str, api_url: str,
                                 wallet_address: str = "0x0000000000000000000000000000000000000000") -> str:
        """Probe all known pos-coin API endpoints. Exploits V-001 (no auth).
        Tests: getUserInfo, getDetailedBalance, Mining, Activity, Exchange,
        Withdraw, Virtualaddress, and Config endpoints.
        Use wallet_address to query a specific victim's data."""
        guardrails.enforce("poscoin_api_probe", target)
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled in config."})

        api_url = api_url.rstrip("/")
        results = {}

        # V2 endpoints
        v2_endpoints = {
            "getUserInfo": {"address": wallet_address, "chaintype": "erc", "invite": ""},
            "getDetailedBalance": {"address": wallet_address},
            "getMining": {"address": wallet_address},
            "activityQuery": {"address": wallet_address},
            "getExchange": {"address": wallet_address},
            "getWithdrawal": {"address": wallet_address},
            "getVirtualaddress": {"chainType": "erc"},
            "getConfig": {"chainType": "erc"},
        }

        endpoint_map = {
            "getUserInfo": "Fishpond/getUserInfo",
            "getDetailedBalance": "Fishpond/getDetailedBalance",
            "getMining": "Mining/getMining",
            "activityQuery": "Activity/activityQuery",
            "getExchange": "Exchange/getExchange",
            "getWithdrawal": "Withdraw/getWithdrawal",
            "getVirtualaddress": "Virtualaddress/getVirtualaddress",
            "getConfig": "Config/getConfig",
        }

        for name, params in v2_endpoints.items():
            path = endpoint_map[name]
            param_str = "&".join(f"{k}={v}" for k, v in params.items())
            cmd = ["curl", "-s", "--max-time", "8", "-X", "POST",
                   f"{api_url}/{path}",
                   "-d", param_str,
                   "-H", "Content-Type: application/x-www-form-urlencoded"]
            output = await asyncio.to_thread(
                run_command_with_log, cmd, guardrails.get_timeout())
            try:
                results[name] = json.loads(output)
            except json.JSONDecodeError:
                results[name] = {"raw": output[:500] if output else "empty",
                                 "status": "parse_error"}

        result = {"target": target, "api_url": api_url,
                  "wallet_queried": wallet_address,
                  "endpoints": results}
        save_result(target, "poscoin_api_probe",
                    ["poscoin_api_probe", api_url], json.dumps(result))
        return json.dumps(result)

    @mcp.tool()
    async def poscoin_urlscan_hunt(target: str, max_results: int = 100) -> str:
        """Hunt for new pos-coin deployments via urlscan.io.
        Searches for page.title:pos-coin and returns all matching domains
        with their IPs, ASNs, tags, and timestamps. No authentication needed."""
        guardrails.enforce("poscoin_urlscan_hunt", target)

        cmd = ["curl", "-s", "--max-time", "30",
               f"https://urlscan.io/api/v1/search/?q=page.title%3Apos-coin&size={max_results}"]
        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        try:
            data = json.loads(output)
        except json.JSONDecodeError:
            return json.dumps({"error": "Failed to parse urlscan.io response"})

        domains = {}
        for r in data.get("results", []):
            page = r.get("page", {})
            task = r.get("task", {})
            title = page.get("title", "")
            if "pos-coin" not in title.lower():
                continue
            domain = task.get("domain", "?")
            if domain not in domains:
                domains[domain] = {
                    "first_seen": task.get("time", "?"),
                    "last_seen": task.get("time", "?"),
                    "ip": page.get("ip", "?"),
                    "server": page.get("server", "?"),
                    "asn": page.get("asnname", "?"),
                    "tags": task.get("tags", []),
                    "scans": 1,
                    "known_infra": KNOWN_INFRA_IPS.get(
                        page.get("ip", "").split(",")[0].strip(), None),
                }
            else:
                domains[domain]["scans"] += 1
                domains[domain]["last_seen"] = task.get("time",
                                                         domains[domain]["last_seen"])

        result = {
            "total_results": len(data.get("results", [])),
            "unique_domains": len(domains),
            "domains": domains,
        }
        save_result(target, "poscoin_urlscan_hunt",
                    ["poscoin_urlscan_hunt"], json.dumps(result))
        return json.dumps(result)

    @mcp.tool()
    async def poscoin_trace_wallet(target: str, wallet: str,
                                    chain: str = "eth") -> str:
        """Trace a drain wallet's transferFrom history on Ethereum.
        Queries Blockscout API to enumerate all victims and money flow.
        wallet: the drain wallet address (0x...).
        Returns: list of victims, amounts stolen, destination wallets."""
        guardrails.enforce("poscoin_trace_wallet", target)

        if chain == "eth":
            api_base = "https://eth.blockscout.com/api/v2"
        elif chain == "bsc":
            api_base = "https://bsc.blockscout.com/api/v2"
        elif chain == "polygon":
            api_base = "https://polygon.blockscout.com/api/v2"
        else:
            return json.dumps({"error": f"Unsupported chain: {chain}"})

        all_victims = {}
        total_stolen = 0
        total_drains = 0
        page = 0
        params = "filter=from"

        while page < 20:  # Safety limit
            page += 1
            cmd = ["curl", "-s", "--max-time", "15",
                   f"{api_base}/addresses/{wallet}/transactions?{params}"]
            output = await asyncio.to_thread(
                run_command_with_log, cmd, guardrails.get_timeout())

            try:
                data = json.loads(output)
            except json.JSONDecodeError:
                break

            items = data.get("items", [])
            if not items:
                break

            for tx in items:
                decoded = tx.get("decoded_input", {})
                if not decoded:
                    continue
                method = decoded.get("method_call", "")
                if "transferFrom" not in method:
                    continue

                victim = dest = amount_raw = None
                for p in decoded.get("parameters", []):
                    if p.get("name") in ("from", "_from"):
                        victim = p.get("value")
                    elif p.get("name") in ("to", "_to"):
                        dest = p.get("value")
                    elif p.get("name") in ("value", "_value"):
                        amount_raw = int(p.get("value", "0"))

                if not victim or not amount_raw:
                    continue

                # USDC = 6 decimals, USDT varies
                amount = amount_raw / 1e6
                ts = tx.get("timestamp", "?")
                tx_hash = tx.get("hash", "?")

                if amount > 0:
                    total_stolen += amount
                    total_drains += 1
                    if victim not in all_victims:
                        all_victims[victim] = {
                            "total": 0, "count": 0,
                            "first": ts, "last": ts,
                            "destinations": []
                        }
                    all_victims[victim]["total"] += amount
                    all_victims[victim]["count"] += 1
                    all_victims[victim]["first"] = ts
                    if dest and dest not in all_victims[victim]["destinations"]:
                        all_victims[victim]["destinations"].append(dest)

            next_params = data.get("next_page_params")
            if not next_params:
                break
            from urllib.parse import urlencode
            params = urlencode(next_params)
            await asyncio.sleep(0.3)

        # Sort victims by amount
        sorted_victims = sorted(
            [{"address": addr, **info} for addr, info in all_victims.items()],
            key=lambda x: -x["total"]
        )

        # Check against known drain wallets
        known = KNOWN_DRAIN_WALLETS.get(wallet.lower())

        result = {
            "drain_wallet": wallet,
            "chain": chain,
            "known_attribution": known,
            "pages_scanned": page,
            "total_drains": total_drains,
            "total_stolen_usd": round(total_stolen, 2),
            "unique_victims": len(all_victims),
            "victims": sorted_victims[:50],  # Top 50
        }
        save_result(target, "poscoin_trace_wallet",
                    ["poscoin_trace_wallet", wallet], json.dumps(result))
        return json.dumps(result)

    @mcp.tool()
    async def poscoin_enumerate_victims(target: str, wallet: str) -> str:
        """Given a drain wallet address, query the pos-coin API's
        Fishpond/getUserInfo endpoint to check if specific wallets
        have been approved (is_auth status). Exploits V-003 (enumerable
        victim registry). Requires a live pos-coin API URL in target."""
        guardrails.enforce("poscoin_enumerate_victims", target)
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled in config."})

        api_url = target.rstrip("/")
        results = {}

        for chain in ["erc", "bsc", "trc"]:
            cmd = ["curl", "-s", "--max-time", "8", "-X", "POST",
                   f"{api_url}/Fishpond/getUserInfo",
                   "-d", f"address={wallet}&chaintype={chain}&invite=",
                   "-H", "Content-Type: application/x-www-form-urlencoded"]
            output = await asyncio.to_thread(
                run_command_with_log, cmd, guardrails.get_timeout())
            try:
                data = json.loads(output)
                results[chain] = {
                    "is_auth": data.get("data", {}).get("is_auth", "unknown"),
                    "response": data,
                }
            except json.JSONDecodeError:
                results[chain] = {"status": "no_response"}

        result = {
            "wallet_queried": wallet,
            "api_url": api_url,
            "auth_status": results,
        }
        save_result(target, "poscoin_enumerate_victims",
                    ["poscoin_enumerate_victims", wallet], json.dumps(result))
        return json.dumps(result)
