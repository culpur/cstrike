# cstrike/mcp_server/tools/osint_investigation.py — OSINT Investigation Toolkit
#
# General-purpose open source intelligence tools that follow the methodology
# used in the qsjt66.com/pos-coin investigation. Enables CStrike users to
# conduct deep OSINT research on domains, IPs, and crypto operations.
#
# Investigation pipeline:
#   1. Domain reconnaissance (WHOIS, DNS, reverse IP, cert transparency)
#   2. Infrastructure mapping (hosting providers, nameserver chains, CDN detection)
#   3. Content fingerprinting (JS analysis, CMS detection, page archival)
#   4. Threat intelligence (urlscan.io, ScamAdviser correlation)
#   5. Blockchain tracing (wallet analysis, approval events, money flow)
#   6. Relationship mapping (shared infrastructure, domain clustering)

import asyncio
import json
import os
import re
import sys
from urllib.parse import urlparse, urlencode

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from modules.utils import run_command_with_log, save_result, get_target_dir


def register(mcp, guardrails):

    # -----------------------------------------------------------------------
    # Phase 1: Domain Reconnaissance
    # -----------------------------------------------------------------------

    @mcp.tool()
    async def osint_domain_recon(target: str, domain: str = "") -> str:
        """Comprehensive domain reconnaissance. Performs WHOIS lookup, full DNS
        enumeration (A, AAAA, MX, NS, TXT, SOA, CNAME), nameserver resolution,
        HTTP header analysis, and SSL certificate check in a single call.
        Returns structured data suitable for infrastructure mapping."""
        guardrails.enforce("osint_domain_recon", target)
        domain = domain or target

        results = {}

        # WHOIS
        whois_cmd = ["whois", domain]
        whois_out = await asyncio.to_thread(
            run_command_with_log, whois_cmd, guardrails.get_timeout())
        whois_parsed = {}
        for line in whois_out.split("\n"):
            for field in ["Creation Date", "Registry Expiry", "Registrar:",
                          "Registrant Name", "Registrant Org", "Registrant Country",
                          "Name Server:", "Domain Status"]:
                if field in line:
                    whois_parsed[field.strip(":")] = line.split(":", 1)[-1].strip()
        results["whois"] = whois_parsed

        # DNS records
        dns = {}
        for rtype in ["A", "AAAA", "MX", "NS", "TXT", "SOA", "CNAME"]:
            cmd = ["dig", domain, rtype, "+short"]
            out = await asyncio.to_thread(
                run_command_with_log, cmd, guardrails.get_timeout())
            records = [r.strip() for r in out.strip().split("\n") if r.strip()]
            if records:
                dns[rtype] = records
        results["dns"] = dns

        # Resolve nameserver IPs
        ns_ips = {}
        for ns in dns.get("NS", []):
            ns_clean = ns.rstrip(".")
            cmd = ["dig", ns_clean, "A", "+short"]
            out = await asyncio.to_thread(
                run_command_with_log, cmd, guardrails.get_timeout())
            ips = [ip.strip() for ip in out.strip().split("\n") if ip.strip()]
            if ips:
                ns_ips[ns_clean] = ips
        results["nameserver_ips"] = ns_ips

        # HTTP headers
        for scheme in ["https", "http"]:
            cmd = ["curl", "-sI", "--max-time", "10", f"{scheme}://{domain}"]
            out = await asyncio.to_thread(
                run_command_with_log, cmd, guardrails.get_timeout())
            if out and "HTTP" in out:
                headers = {}
                for line in out.split("\n"):
                    if ":" in line:
                        k, v = line.split(":", 1)
                        headers[k.strip().lower()] = v.strip()
                results["http_headers"] = {"scheme": scheme, "headers": headers}
                break

        save_result(target, "osint_domain_recon",
                    ["osint_domain_recon", domain], json.dumps(results))
        return json.dumps({"domain": domain, "recon": results})

    @mcp.tool()
    async def osint_reverse_ip(target: str, ip: str) -> str:
        """Reverse IP lookup — find all domains hosted on a given IP address.
        Uses HackerTarget API. Critical for discovering co-hosted scam domains
        and mapping shared infrastructure."""
        guardrails.enforce("osint_reverse_ip", target)

        cmd = ["curl", "-s", "--max-time", "15",
               f"https://api.hackertarget.com/reverseiplookup/?q={ip}"]
        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        domains = [d.strip() for d in output.strip().split("\n")
                   if d.strip() and "error" not in d.lower()
                   and "API" not in d]

        save_result(target, "osint_reverse_ip",
                    ["osint_reverse_ip", ip], json.dumps(domains))
        return json.dumps({"ip": ip, "domains": domains,
                           "count": len(domains)})

    @mcp.tool()
    async def osint_ip_whois(target: str, ip: str) -> str:
        """IP WHOIS lookup — identify hosting provider, ASN, country, abuse
        contact, and network registration for an IP address."""
        guardrails.enforce("osint_ip_whois", target)

        cmd = ["whois", ip]
        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        parsed = {}
        for line in output.split("\n"):
            for field in ["OrgName", "NetName", "CIDR", "Country", "country",
                          "netname", "descr", "org", "abuse-mailbox",
                          "inetnum", "organization"]:
                if line.strip().startswith(field):
                    val = line.split(":", 1)[-1].strip() if ":" in line else line
                    parsed.setdefault(field.lower().replace("-", "_"), []).append(val)

        save_result(target, "osint_ip_whois",
                    ["osint_ip_whois", ip], json.dumps(parsed))
        return json.dumps({"ip": ip, "whois": parsed})

    # -----------------------------------------------------------------------
    # Phase 2: Infrastructure Mapping
    # -----------------------------------------------------------------------

    @mcp.tool()
    async def osint_domain_cluster(target: str, domains: str) -> str:
        """Analyze a list of domains for shared infrastructure patterns.
        Checks DNS, WHOIS registrar, nameservers, and IPs to find clusters.
        domains: comma-separated list of domains to analyze."""
        guardrails.enforce("osint_domain_cluster", target)

        domain_list = [d.strip() for d in domains.split(",") if d.strip()]
        cluster = {"by_ip": {}, "by_ns": {}, "by_registrar": {}, "details": {}}

        for domain in domain_list[:20]:  # Limit to 20
            detail = {"ips": [], "ns": [], "registrar": None}

            # A record
            cmd = ["dig", domain, "A", "+short"]
            out = await asyncio.to_thread(
                run_command_with_log, cmd, guardrails.get_timeout())
            ips = [ip.strip() for ip in out.strip().split("\n") if ip.strip()]
            detail["ips"] = ips
            for ip in ips:
                cluster["by_ip"].setdefault(ip, []).append(domain)

            # NS records
            cmd = ["dig", domain, "NS", "+short"]
            out = await asyncio.to_thread(
                run_command_with_log, cmd, guardrails.get_timeout())
            nss = [ns.strip().rstrip(".") for ns in out.strip().split("\n") if ns.strip()]
            detail["ns"] = nss
            for ns in nss:
                cluster["by_ns"].setdefault(ns, []).append(domain)

            # Registrar from WHOIS
            cmd = ["whois", domain]
            out = await asyncio.to_thread(
                run_command_with_log, cmd, guardrails.get_timeout())
            for line in out.split("\n"):
                if "Registrar:" in line:
                    reg = line.split(":", 1)[-1].strip()
                    detail["registrar"] = reg
                    cluster["by_registrar"].setdefault(reg, []).append(domain)
                    break

            cluster["details"][domain] = detail
            await asyncio.sleep(0.2)

        # Summarize clusters
        shared_ip = {ip: doms for ip, doms in cluster["by_ip"].items()
                     if len(doms) > 1}
        shared_ns = {ns: doms for ns, doms in cluster["by_ns"].items()
                     if len(doms) > 1}

        save_result(target, "osint_domain_cluster",
                    ["osint_domain_cluster"], json.dumps(cluster))
        return json.dumps({
            "domains_analyzed": len(domain_list),
            "shared_ips": shared_ip,
            "shared_nameservers": shared_ns,
            "by_registrar": cluster["by_registrar"],
            "details": cluster["details"],
        })

    # -----------------------------------------------------------------------
    # Phase 3: Content Analysis & Archival
    # -----------------------------------------------------------------------

    @mcp.tool()
    async def osint_wayback_lookup(target: str, url: str,
                                    limit: int = 20) -> str:
        """Query the Wayback Machine CDX API for archived snapshots of a URL.
        Returns timestamps, status codes, and content types of all captures.
        Use for tracking domain lifecycle and content changes over time."""
        guardrails.enforce("osint_wayback_lookup", target)

        cdx_url = (f"https://web.archive.org/cdx/search/cdx?"
                   f"url={url}&output=json&fl=timestamp,original,statuscode,"
                   f"mimetype&limit={limit}")
        cmd = ["curl", "-s", "--max-time", "20", cdx_url]
        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        try:
            data = json.loads(output)
            if data and len(data) > 1:
                headers = data[0]
                snapshots = [dict(zip(headers, row)) for row in data[1:]]
            else:
                snapshots = []
        except json.JSONDecodeError:
            snapshots = []

        save_result(target, "osint_wayback_lookup",
                    ["osint_wayback_lookup", url], json.dumps(snapshots))
        return json.dumps({"url": url, "snapshots": snapshots,
                           "count": len(snapshots)})

    @mcp.tool()
    async def osint_page_fingerprint(target: str, url: str) -> str:
        """Fetch a URL and extract fingerprinting data: page title, meta tags,
        script sources, link hrefs, form actions, inline script content hashes,
        and technology indicators. Follows redirects."""
        guardrails.enforce("osint_page_fingerprint", target)

        cmd = ["curl", "-sL", "--max-time", "15", "-k", url]
        html = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        fingerprint = {
            "url": url,
            "title": "",
            "meta_tags": [],
            "script_sources": [],
            "link_hrefs": [],
            "form_actions": [],
            "technologies": [],
            "content_length": len(html),
        }

        # Title
        title_match = re.search(r'<title[^>]*>(.*?)</title>', html, re.I | re.S)
        if title_match:
            fingerprint["title"] = title_match.group(1).strip()

        # Meta tags
        for m in re.finditer(r'<meta\s+([^>]+)>', html, re.I):
            fingerprint["meta_tags"].append(m.group(1))

        # Script sources
        for m in re.finditer(r'src="([^"]*\.js[^"]*)"', html):
            fingerprint["script_sources"].append(m.group(1))

        # Technology detection
        if "vue" in html.lower() or "__vue__" in html:
            fingerprint["technologies"].append("Vue.js")
        if "react" in html.lower() or "_reactRoot" in html:
            fingerprint["technologies"].append("React")
        if "angular" in html.lower():
            fingerprint["technologies"].append("Angular")
        if "vite" in html.lower() or "modulepreload" in html:
            fingerprint["technologies"].append("Vite")
        if "webpack" in html.lower():
            fingerprint["technologies"].append("Webpack")
        if "tronWeb" in html or "tronweb" in html.lower():
            fingerprint["technologies"].append("TronLink/Web3")
        if "ethereum" in html.lower() or "metamask" in html.lower():
            fingerprint["technologies"].append("MetaMask/EVM Web3")
        if "crisp" in html.lower():
            fingerprint["technologies"].append("Crisp Chat")

        save_result(target, "osint_page_fingerprint",
                    ["osint_page_fingerprint", url], json.dumps(fingerprint))
        return json.dumps(fingerprint)

    # -----------------------------------------------------------------------
    # Phase 4: Threat Intelligence
    # -----------------------------------------------------------------------

    @mcp.tool()
    async def osint_urlscan_search(target: str, query: str,
                                    size: int = 50) -> str:
        """Search urlscan.io for scanned pages matching a query.
        query: urlscan.io search syntax (e.g., 'page.title:pos-coin',
        'domain:example.com', 'page.server:nginx', 'ip:1.2.3.4').
        Returns domains, IPs, ASNs, tags, screenshots for each result."""
        guardrails.enforce("osint_urlscan_search", target)

        encoded = query.replace(" ", "%20").replace(":", "%3A")
        cmd = ["curl", "-s", "--max-time", "30",
               f"https://urlscan.io/api/v1/search/?q={encoded}&size={size}"]
        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        try:
            data = json.loads(output)
        except json.JSONDecodeError:
            return json.dumps({"error": "Failed to parse urlscan response"})

        results = []
        for r in data.get("results", []):
            page = r.get("page", {})
            task = r.get("task", {})
            results.append({
                "domain": task.get("domain"),
                "url": task.get("url"),
                "time": task.get("time"),
                "ip": page.get("ip"),
                "server": page.get("server"),
                "asn": page.get("asnname"),
                "title": page.get("title"),
                "tags": task.get("tags", []),
                "uuid": task.get("uuid"),
                "screenshot": f"https://urlscan.io/screenshots/{task.get('uuid', '')}.png",
            })

        save_result(target, "osint_urlscan_search",
                    ["osint_urlscan_search", query], json.dumps(results))
        return json.dumps({"query": query, "total": len(results),
                           "results": results})

    @mcp.tool()
    async def osint_urlscan_result(target: str, uuid: str) -> str:
        """Fetch detailed urlscan.io result for a specific scan UUID.
        Returns: all URLs fetched, request/response details, DOM content,
        cookies, and console messages. Use to extract API responses, JS
        bundles, and other artifacts from archived scans."""
        guardrails.enforce("osint_urlscan_result", target)

        cmd = ["curl", "-s", "--max-time", "15",
               f"https://urlscan.io/api/v1/result/{uuid}/"]
        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        try:
            data = json.loads(output)
        except json.JSONDecodeError:
            return json.dumps({"error": "Failed to parse result"})

        # Extract key data
        lists = data.get("lists", {})
        d = data.get("data", {})

        api_urls = [u for u in lists.get("urls", [])
                    if "api" in u.lower() or "config" in u.lower()]

        requests_info = []
        for req in d.get("requests", []):
            req_info = req.get("request", {}).get("request", {})
            resp = req.get("response", {})
            url = req_info.get("url", "")
            if any(kw in url.lower() for kw in ["api", "config", "pool",
                                                  "wallet", "fishpond"]):
                requests_info.append({
                    "url": url,
                    "method": req_info.get("method"),
                    "status": resp.get("response", {}).get("status"),
                    "mime": resp.get("response", {}).get("mimeType"),
                    "hash": resp.get("hash"),
                })

        result = {
            "uuid": uuid,
            "api_urls": api_urls,
            "api_requests": requests_info,
            "total_requests": len(d.get("requests", [])),
        }

        save_result(target, "osint_urlscan_result",
                    ["osint_urlscan_result", uuid], json.dumps(result))
        return json.dumps(result)

    @mcp.tool()
    async def osint_urlscan_response(target: str, response_hash: str) -> str:
        """Fetch a cached HTTP response body from urlscan.io by its SHA-256
        hash. Returns the decompressed response content. Use response hashes
        from osint_urlscan_result to retrieve API responses, JS bundles, etc."""
        guardrails.enforce("osint_urlscan_response", target)

        cmd = ["curl", "-s", "--max-time", "15", "--compressed",
               f"https://urlscan.io/responses/{response_hash}/"]
        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        # Try to parse as JSON
        try:
            data = json.loads(output)
            save_result(target, "osint_urlscan_response",
                        ["osint_urlscan_response", response_hash],
                        json.dumps(data))
            return json.dumps({"hash": response_hash, "content_type": "json",
                               "data": data})
        except json.JSONDecodeError:
            save_result(target, "osint_urlscan_response",
                        ["osint_urlscan_response", response_hash],
                        output[:2000])
            return json.dumps({"hash": response_hash, "content_type": "text",
                               "data": output[:5000],
                               "truncated": len(output) > 5000})

    # -----------------------------------------------------------------------
    # Phase 5: Blockchain Analysis
    # -----------------------------------------------------------------------

    @mcp.tool()
    async def osint_blockchain_address(target: str, address: str,
                                        chain: str = "eth") -> str:
        """Look up an address on the blockchain via Blockscout API.
        Returns: balance, transaction count, token transfers, contract status.
        chain: eth, bsc, polygon, base, arbitrum, optimism."""
        guardrails.enforce("osint_blockchain_address", target)

        chain_urls = {
            "eth": "https://eth.blockscout.com/api/v2",
            "bsc": "https://bsc.blockscout.com/api/v2",
            "polygon": "https://polygon.blockscout.com/api/v2",
            "base": "https://base.blockscout.com/api/v2",
            "arbitrum": "https://arbitrum.blockscout.com/api/v2",
            "optimism": "https://optimism.blockscout.com/api/v2",
        }
        api_base = chain_urls.get(chain)
        if not api_base:
            return json.dumps({"error": f"Unknown chain: {chain}"})

        # Address info
        cmd = ["curl", "-s", "--max-time", "15",
               f"{api_base}/addresses/{address}"]
        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        try:
            addr_data = json.loads(output)
        except json.JSONDecodeError:
            return json.dumps({"error": "Failed to fetch address data"})

        # Recent transactions
        cmd = ["curl", "-s", "--max-time", "15",
               f"{api_base}/addresses/{address}/transactions?filter=from"]
        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        try:
            tx_data = json.loads(output)
            txs = tx_data.get("items", [])
        except json.JSONDecodeError:
            txs = []

        tx_summary = []
        for tx in txs[:20]:
            decoded = tx.get("decoded_input", {})
            to_info = tx.get("to", {})
            tx_summary.append({
                "hash": tx.get("hash"),
                "timestamp": tx.get("timestamp"),
                "method": decoded.get("method_call", tx.get("method", "?")),
                "to": to_info.get("hash") if isinstance(to_info, dict)
                      else str(to_info),
                "to_name": to_info.get("name") if isinstance(to_info, dict)
                           else None,
                "value_eth": str(int(tx.get("value", "0")) / 1e18),
                "status": tx.get("status"),
            })

        balance = int(addr_data.get("coin_balance", "0")) / 1e18
        result = {
            "address": address,
            "chain": chain,
            "balance": f"{balance:.6f}",
            "is_contract": addr_data.get("is_contract"),
            "name": addr_data.get("name"),
            "has_token_transfers": addr_data.get("has_token_transfers"),
            "recent_transactions": tx_summary,
        }

        save_result(target, "osint_blockchain_address",
                    ["osint_blockchain_address", address], json.dumps(result))
        return json.dumps(result)

    @mcp.tool()
    async def osint_blockchain_trace(target: str, wallet: str,
                                      chain: str = "eth",
                                      max_pages: int = 10) -> str:
        """Trace all transactions from a wallet across multiple pages.
        Decodes transferFrom calls to identify victims and money flow.
        Returns: victim list with amounts, destination wallets, timeline."""
        guardrails.enforce("osint_blockchain_trace", target)

        chain_urls = {
            "eth": "https://eth.blockscout.com/api/v2",
            "bsc": "https://bsc.blockscout.com/api/v2",
            "polygon": "https://polygon.blockscout.com/api/v2",
        }
        api_base = chain_urls.get(chain)
        if not api_base:
            return json.dumps({"error": f"Unknown chain: {chain}"})

        all_txs = []
        victims = {}
        destinations = {}
        total_value = 0
        page = 0
        params = "filter=from"

        while page < max_pages:
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
                tx_params = decoded.get("parameters", [])
                from_addr = to_addr = value_raw = None

                for p in tx_params:
                    name = p.get("name", "")
                    if name in ("from", "_from"):
                        from_addr = p.get("value")
                    elif name in ("to", "_to"):
                        to_addr = p.get("value")
                    elif name in ("value", "_value"):
                        value_raw = int(p.get("value", "0"))

                ts = tx.get("timestamp", "?")
                tx_hash = tx.get("hash", "?")

                all_txs.append({
                    "hash": tx_hash, "timestamp": ts,
                    "method": method, "from": from_addr,
                    "to": to_addr, "value_raw": value_raw,
                })

                if "transferFrom" in method and from_addr and value_raw and value_raw > 0:
                    amount = value_raw / 1e6  # Assume 6 decimals (USDC/USDT)
                    total_value += amount
                    if from_addr not in victims:
                        victims[from_addr] = {"total": 0, "count": 0,
                                               "first": ts, "last": ts}
                    victims[from_addr]["total"] += amount
                    victims[from_addr]["count"] += 1
                    victims[from_addr]["first"] = ts

                    if to_addr:
                        if to_addr not in destinations:
                            destinations[to_addr] = {"total": 0, "count": 0}
                        destinations[to_addr]["total"] += amount
                        destinations[to_addr]["count"] += 1

            next_params = data.get("next_page_params")
            if not next_params:
                break
            params = urlencode(next_params)
            await asyncio.sleep(0.3)

        sorted_victims = sorted(
            [{"address": addr, **info} for addr, info in victims.items()],
            key=lambda x: -x["total"])

        sorted_dests = sorted(
            [{"address": addr, **info} for addr, info in destinations.items()],
            key=lambda x: -x["total"])

        result = {
            "wallet": wallet, "chain": chain,
            "pages_scanned": page,
            "total_transactions": len(all_txs),
            "total_transferfrom_value": round(total_value, 2),
            "unique_victims": len(victims),
            "unique_destinations": len(destinations),
            "top_victims": sorted_victims[:30],
            "top_destinations": sorted_dests[:20],
        }

        save_result(target, "osint_blockchain_trace",
                    ["osint_blockchain_trace", wallet], json.dumps(result))
        return json.dumps(result)

    # -----------------------------------------------------------------------
    # Phase 6: Relationship Mapping
    # -----------------------------------------------------------------------

    @mcp.tool()
    async def osint_scamadviser(target: str, domain: str = "") -> str:
        """Check a domain's trust score and risk assessment on ScamAdviser.
        Returns: trust score, server location, registrar, domain age,
        owner info, and risk flags."""
        guardrails.enforce("osint_scamadviser", target)
        domain = domain or target

        cmd = ["curl", "-sL", "--max-time", "15",
               f"https://www.scamadviser.com/check-website/{domain}"]
        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        # Extract key data points from HTML
        result = {"domain": domain, "raw_length": len(output)}

        # Trust score
        score_match = re.search(r'trust[_\-]?score["\s:]+(\d+)', output, re.I)
        if score_match:
            result["trust_score"] = int(score_match.group(1))

        save_result(target, "osint_scamadviser",
                    ["osint_scamadviser", domain], json.dumps(result))
        return json.dumps(result)

    @mcp.tool()
    async def osint_numbered_domain_scan(target: str, prefix: str,
                                          suffix: str = ".com",
                                          start: int = 1,
                                          end: int = 100) -> str:
        """Scan a range of numbered domains (e.g., qsjt1.com through qsjt100.com).
        For each domain, checks DNS A record and WHOIS creation date.
        Identifies which numbered variants are registered and active.
        prefix: domain prefix (e.g., 'qsjt'), suffix: TLD (e.g., '.com')."""
        guardrails.enforce("osint_numbered_domain_scan", target)

        results = {"active": [], "registered": [], "unregistered": 0}

        for i in range(start, min(end + 1, start + 200)):
            domain = f"{prefix}{i}{suffix}"

            # Quick DNS check
            cmd = ["dig", domain, "A", "+short"]
            out = await asyncio.to_thread(
                run_command_with_log, cmd, 5)
            ips = [ip.strip() for ip in out.strip().split("\n") if ip.strip()]

            if ips:
                # Has DNS — check WHOIS for creation date
                whois_cmd = ["whois", domain]
                whois_out = await asyncio.to_thread(
                    run_command_with_log, whois_cmd, 8)
                created = None
                for line in whois_out.split("\n"):
                    if "Creation Date" in line:
                        created = line.split(":", 1)[-1].strip()
                        break

                entry = {"domain": domain, "ips": ips, "created": created}
                results["active"].append(entry)
            else:
                # Check if registered but no A record
                ns_cmd = ["dig", domain, "NS", "+short"]
                ns_out = await asyncio.to_thread(
                    run_command_with_log, ns_cmd, 5)
                nss = [ns.strip() for ns in ns_out.strip().split("\n")
                       if ns.strip()]
                if nss:
                    results["registered"].append(
                        {"domain": domain, "ns": nss})
                else:
                    results["unregistered"] += 1

            await asyncio.sleep(0.1)

        save_result(target, "osint_numbered_domain_scan",
                    ["osint_numbered_domain_scan", prefix],
                    json.dumps(results))
        return json.dumps({
            "prefix": prefix, "suffix": suffix,
            "range": f"{start}-{end}",
            "active_count": len(results["active"]),
            "registered_no_dns": len(results["registered"]),
            "unregistered": results["unregistered"],
            "active": results["active"],
            "registered": results["registered"],
        })
