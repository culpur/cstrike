# cstrike/modules/vulnapi.py
# VulnAPI Integration Module - API Security Scanning

import os
import re
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from modules.utils import run_command_with_log, save_result, get_target_dir
from modules.loot_tracker import add_loot

VULNAPI_TIMEOUT = 300

# Well-known paths where OpenAPI/Swagger specs are commonly found
API_SPEC_PATHS = [
    "/swagger.json",
    "/swagger/v1/swagger.json",
    "/openapi.json",
    "/openapi/v1/openapi.json",
    "/api-docs",
    "/api-docs.json",
    "/v1/api-docs",
    "/v2/api-docs",
    "/v3/api-docs",
    "/.well-known/openapi.json",
    "/docs/openapi.json",
]

# Common API base paths to probe
API_BASE_PATHS = [
    "/api",
    "/api/v1",
    "/api/v2",
    "/api/v3",
    "/rest",
    "/graphql",
    "/v1",
    "/v2",
]


def check_vulnapi_installed():
    """Check if vulnapi binary is available on PATH"""
    return shutil.which("vulnapi") is not None


def parse_vulnapi_output(raw):
    """
    Parse VulnAPI table-format stdout into structured dicts.

    VulnAPI outputs results in a table format like:
    | ID | Name | Severity | CVSS 4.0 | OWASP | URL |

    Returns:
        list of dicts: [{name, severity, cvss, owasp, url, id}, ...]
    """
    findings = []
    if not raw:
        return findings

    lines = raw.strip().splitlines()

    for line in lines:
        line = line.strip()
        if not line or line.startswith("+") or line.startswith("| ID"):
            continue

        # Try table row format: | col1 | col2 | ... |
        if line.startswith("|"):
            cols = [c.strip() for c in line.split("|")[1:-1]]
            if len(cols) >= 4:
                finding = {
                    "id": cols[0] if len(cols) > 0 else "",
                    "name": cols[1] if len(cols) > 1 else "",
                    "severity": cols[2].lower() if len(cols) > 2 else "info",
                    "cvss": cols[3] if len(cols) > 3 else "0.0",
                    "owasp": cols[4] if len(cols) > 4 else "",
                    "url": cols[5] if len(cols) > 5 else "",
                }
                # Skip header rows
                if finding["severity"] in ("low", "medium", "high", "critical", "info"):
                    findings.append(finding)
                continue

        # Fallback: try regex for less structured output
        match = re.match(
            r".*?([\w\s-]+?)\s+\|\s*(low|medium|high|critical|info)\s*\|\s*([\d.]+)",
            line, re.IGNORECASE
        )
        if match:
            findings.append({
                "name": match.group(1).strip(),
                "severity": match.group(2).lower(),
                "cvss": match.group(3),
                "owasp": "",
                "url": "",
            })

    return findings


def discover_api_endpoints(target, target_dir=None):
    """
    Mine existing recon data for API base URLs.

    Checks urls.json, httpx.json, and loot.json for URLs that look like API endpoints.

    Args:
        target: Target hostname/IP
        target_dir: Path to target results directory (auto-resolved if None)

    Returns:
        list of str: Discovered API base URLs
    """
    if target_dir is None:
        target_dir = get_target_dir(target)

    api_urls = set()
    target_dir = Path(target_dir)

    # Mine urls.json
    urls_file = target_dir / "urls.json"
    if urls_file.exists():
        try:
            data = json.loads(urls_file.read_text())
            if isinstance(data, list):
                for url in data:
                    api_urls.add(url.rstrip("/"))
            elif isinstance(data, dict) and "output" in data:
                # Wrapped format from save_result
                for line in data["output"].splitlines():
                    line = line.strip()
                    if line.startswith("http"):
                        api_urls.add(line.rstrip("/"))
        except Exception:
            pass

    # Mine httpx.json
    httpx_file = target_dir / "httpx.json"
    if httpx_file.exists():
        try:
            data = json.loads(httpx_file.read_text())
            output = data.get("output", "") if isinstance(data, dict) else ""
            for line in output.splitlines():
                try:
                    entry = json.loads(line)
                    if "url" in entry:
                        api_urls.add(entry["url"].rstrip("/"))
                except json.JSONDecodeError:
                    continue
        except Exception:
            pass

    # Mine loot.json for URLs
    loot_file = target_dir / "loot.json"
    if loot_file.exists():
        try:
            loot = json.loads(loot_file.read_text())
            for url in loot.get("urls", []):
                api_urls.add(url.rstrip("/"))
        except Exception:
            pass

    # If no URLs found from recon, construct defaults from target
    if not api_urls:
        for scheme in ["https", "http"]:
            api_urls.add(f"{scheme}://{target}")

    return sorted(api_urls)


def probe_api_specs(base_url, timeout=10):
    """
    Probe well-known paths for OpenAPI/Swagger spec files.

    Args:
        base_url: Base URL to probe (e.g., https://example.com)
        timeout: HTTP timeout in seconds

    Returns:
        list of str: URLs where valid spec files were found
    """
    found_specs = []
    base_url = base_url.rstrip("/")

    for path in API_SPEC_PATHS:
        url = f"{base_url}{path}"
        try:
            result = subprocess.run(
                ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                 "--max-time", str(timeout), "-k", url],
                capture_output=True, text=True, timeout=timeout + 5
            )
            status = result.stdout.strip()
            if status in ("200", "301", "302"):
                found_specs.append(url)
                print(f"[+] Found API spec at: {url} (HTTP {status})")
        except Exception:
            continue

    return found_specs


def run_vulnapi_discover(url, socketio=None, scan_id=None, target=None):
    """
    Run vulnapi discover api <URL> to discover API endpoints.

    Args:
        url: URL to discover APIs on
        socketio: Optional SocketIO for real-time events
        scan_id: Optional scan ID for tracking
        target: Optional target name

    Returns:
        str: Raw command output
    """
    if not check_vulnapi_installed():
        print("[!] vulnapi is not installed")
        return ""

    command = ["vulnapi", "discover", "api", url, "--sqa-opt-out"]
    print(f"[+] Running: {' '.join(command)}")

    if socketio:
        socketio.emit('vulnapi_output', {
            'scan_id': scan_id,
            'target': target or url,
            'event': 'discover_start',
            'message': f'Discovering API endpoints on {url}',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    try:
        output = run_command_with_log(command, timeout=VULNAPI_TIMEOUT)

        if socketio:
            socketio.emit('vulnapi_output', {
                'scan_id': scan_id,
                'target': target or url,
                'event': 'discover_complete',
                'message': f'API discovery completed for {url}',
                'output_preview': output[:300] if output else '',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

        return output
    except Exception as e:
        print(f"[!] vulnapi discover failed: {e}")
        if socketio:
            socketio.emit('vulnapi_output', {
                'scan_id': scan_id,
                'target': target or url,
                'event': 'discover_error',
                'message': f'API discovery failed: {str(e)}',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
        return ""


def run_vulnapi_curl_scan(url, headers=None, method="GET",
                          socketio=None, scan_id=None, target=None):
    """
    Run vulnapi scan curl <URL> for direct API scanning (no spec needed).

    Args:
        url: URL to scan
        headers: Optional dict of headers to include
        method: HTTP method (default: GET)
        socketio: Optional SocketIO for real-time events
        scan_id: Optional scan ID
        target: Optional target name

    Returns:
        tuple: (raw_output, parsed_findings)
    """
    if not check_vulnapi_installed():
        print("[!] vulnapi is not installed")
        return "", []

    command = ["vulnapi", "scan", "curl", url, "--sqa-opt-out"]
    if method and method.upper() != "GET":
        command.extend(["-X", method.upper()])
    if headers:
        for key, value in headers.items():
            command.extend(["-H", f"{key}: {value}"])

    print(f"[+] Running: {' '.join(command)}")

    if socketio:
        socketio.emit('vulnapi_output', {
            'scan_id': scan_id,
            'target': target or url,
            'event': 'curl_scan_start',
            'message': f'VulnAPI curl scanning {url}',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    try:
        output = run_command_with_log(command, timeout=VULNAPI_TIMEOUT)
        findings = parse_vulnapi_output(output)

        if socketio:
            socketio.emit('vulnapi_output', {
                'scan_id': scan_id,
                'target': target or url,
                'event': 'curl_scan_complete',
                'message': f'Curl scan found {len(findings)} findings on {url}',
                'findings_count': len(findings),
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

        return output, findings
    except Exception as e:
        print(f"[!] vulnapi curl scan failed: {e}")
        if socketio:
            socketio.emit('vulnapi_output', {
                'scan_id': scan_id,
                'target': target or url,
                'event': 'curl_scan_error',
                'message': f'Curl scan failed: {str(e)}',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
        return "", []


def run_vulnapi_openapi_scan(spec_url, socketio=None, scan_id=None, target=None):
    """
    Run vulnapi scan openapi <SPEC_URL> for spec-based scanning.

    Args:
        spec_url: URL to OpenAPI/Swagger spec
        socketio: Optional SocketIO for real-time events
        scan_id: Optional scan ID
        target: Optional target name

    Returns:
        tuple: (raw_output, parsed_findings)
    """
    if not check_vulnapi_installed():
        print("[!] vulnapi is not installed")
        return "", []

    command = ["vulnapi", "scan", "openapi", spec_url, "--sqa-opt-out"]
    print(f"[+] Running: {' '.join(command)}")

    if socketio:
        socketio.emit('vulnapi_output', {
            'scan_id': scan_id,
            'target': target or spec_url,
            'event': 'openapi_scan_start',
            'message': f'VulnAPI scanning OpenAPI spec at {spec_url}',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    try:
        output = run_command_with_log(command, timeout=VULNAPI_TIMEOUT)
        findings = parse_vulnapi_output(output)

        if socketio:
            socketio.emit('vulnapi_output', {
                'scan_id': scan_id,
                'target': target or spec_url,
                'event': 'openapi_scan_complete',
                'message': f'OpenAPI scan found {len(findings)} findings',
                'findings_count': len(findings),
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

        return output, findings
    except Exception as e:
        print(f"[!] vulnapi openapi scan failed: {e}")
        if socketio:
            socketio.emit('vulnapi_output', {
                'scan_id': scan_id,
                'target': target or spec_url,
                'event': 'openapi_scan_error',
                'message': f'OpenAPI scan failed: {str(e)}',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
        return "", []


def feed_vulns_to_loot(target, vulns):
    """
    Push VulnAPI findings into the loot tracker.

    Args:
        target: Target hostname/IP
        vulns: List of parsed vulnerability dicts
    """
    for vuln in vulns:
        # Add vulnerability to loot
        vuln_desc = f"{vuln.get('name', 'Unknown')} [{vuln.get('severity', 'info')}]"
        if vuln.get('cvss'):
            vuln_desc += f" (CVSS: {vuln['cvss']})"
        add_loot(target, "vulnerability", vuln_desc)

        # Add URL to loot if present
        if vuln.get("url"):
            add_loot(target, "url", vuln["url"])

        # Add protocol category
        add_loot(target, "protocol", "api")


def run_vulnapi_full_scan(target, socketio=None, scan_id=None):
    """
    Orchestrate a full VulnAPI scan for a target:
    1. Discover API endpoints from existing recon data
    2. Probe for OpenAPI specs
    3. Scan each endpoint with curl mode
    4. Scan any specs found with openapi mode
    5. Deduplicate findings
    6. Save results and feed to loot

    Args:
        target: Target hostname/IP
        socketio: Optional SocketIO for real-time events
        scan_id: Optional scan ID for tracking

    Returns:
        dict: {findings: [...], endpoints_scanned: int, specs_found: int, total_findings: int}
    """
    if not check_vulnapi_installed():
        msg = "vulnapi is not installed - skipping API security scanning"
        print(f"[!] {msg}")
        if socketio:
            socketio.emit('vulnapi_output', {
                'scan_id': scan_id,
                'target': target,
                'event': 'skipped',
                'message': msg,
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
        return {"findings": [], "endpoints_scanned": 0, "specs_found": 0, "total_findings": 0}

    target_dir = get_target_dir(target)
    all_findings = []
    seen_names = set()

    if socketio:
        socketio.emit('vulnapi_output', {
            'scan_id': scan_id,
            'target': target,
            'event': 'full_scan_start',
            'message': f'Starting full VulnAPI scan for {target}',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    # Step 1: Discover API endpoints from recon data
    print(f"[+] Discovering API endpoints for {target}")
    endpoints = discover_api_endpoints(target, target_dir)
    print(f"[+] Found {len(endpoints)} base URLs to scan")

    # Step 2: Run vulnapi discover on each endpoint
    for url in endpoints:
        run_vulnapi_discover(url, socketio=socketio, scan_id=scan_id, target=target)

    # Step 3: Probe for OpenAPI specs
    all_specs = []
    for url in endpoints:
        specs = probe_api_specs(url)
        all_specs.extend(specs)
    all_specs = list(set(all_specs))
    print(f"[+] Found {len(all_specs)} OpenAPI spec(s)")

    # Step 4: Scan with curl mode on each endpoint + API base paths
    endpoints_scanned = 0
    for base_url in endpoints:
        # Scan the base URL itself
        _, findings = run_vulnapi_curl_scan(
            base_url, socketio=socketio, scan_id=scan_id, target=target
        )
        for f in findings:
            key = f"{f.get('name', '')}:{f.get('url', base_url)}"
            if key not in seen_names:
                seen_names.add(key)
                if not f.get("url"):
                    f["url"] = base_url
                all_findings.append(f)
        endpoints_scanned += 1

        # Scan common API paths under this base URL
        for path in API_BASE_PATHS:
            api_url = f"{base_url}{path}"
            _, findings = run_vulnapi_curl_scan(
                api_url, socketio=socketio, scan_id=scan_id, target=target
            )
            for f in findings:
                key = f"{f.get('name', '')}:{f.get('url', api_url)}"
                if key not in seen_names:
                    seen_names.add(key)
                    if not f.get("url"):
                        f["url"] = api_url
                    all_findings.append(f)
            endpoints_scanned += 1

    # Step 5: Scan OpenAPI specs
    for spec_url in all_specs:
        _, findings = run_vulnapi_openapi_scan(
            spec_url, socketio=socketio, scan_id=scan_id, target=target
        )
        for f in findings:
            key = f"{f.get('name', '')}:{f.get('url', spec_url)}"
            if key not in seen_names:
                seen_names.add(key)
                if not f.get("url"):
                    f["url"] = spec_url
                all_findings.append(f)

    # Step 6: Feed to loot tracker
    if all_findings:
        feed_vulns_to_loot(target, all_findings)

    # Step 7: Save results
    result_summary = {
        "target": target,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "endpoints_scanned": endpoints_scanned,
        "specs_found": len(all_specs),
        "spec_urls": all_specs,
        "total_findings": len(all_findings),
        "findings": all_findings,
        "severity_counts": {
            "critical": sum(1 for f in all_findings if f.get("severity") == "critical"),
            "high": sum(1 for f in all_findings if f.get("severity") == "high"),
            "medium": sum(1 for f in all_findings if f.get("severity") == "medium"),
            "low": sum(1 for f in all_findings if f.get("severity") == "low"),
            "info": sum(1 for f in all_findings if f.get("severity") == "info"),
        }
    }

    # Save using the standard save_result pattern
    save_result(target, "vulnapi", ["vulnapi", "full-scan", target], json.dumps(result_summary))

    # Also save a standalone results file
    results_path = Path(target_dir) / "vulnapi_results.json"
    results_path.write_text(json.dumps(result_summary, indent=2))

    print(f"[+] VulnAPI scan complete: {len(all_findings)} findings across {endpoints_scanned} endpoints")

    if socketio:
        socketio.emit('vulnapi_output', {
            'scan_id': scan_id,
            'target': target,
            'event': 'full_scan_complete',
            'message': f'VulnAPI found {len(all_findings)} vulnerabilities across {endpoints_scanned} endpoints',
            'findings_count': len(all_findings),
            'severity_counts': result_summary["severity_counts"],
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    return result_summary
