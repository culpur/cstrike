/**
 * OsintInvestigationView — Open-Source Intelligence Investigation Workbench
 *
 * Seven investigation tabs:
 *  1. Domain Recon      — WHOIS, DNS, HTTP headers, nameserver resolution
 *  2. Infrastructure Map — Reverse-IP lookup + IP WHOIS, co-hosted domains
 *  3. Domain Cluster    — Shared infrastructure analysis across many domains
 *  4. Wayback & Content — Wayback Machine snapshots + page fingerprint
 *  5. urlscan.io        — Search, view screenshots, drill into scan results
 *  6. Blockchain        — ETH/BSC/Polygon wallet tracing, transaction mapping
 *  7. Numbered Domain   — Prefix/suffix range scan (e.g., qsjt1-100.com)
 *
 * Push to OpenCTI creates STIX observables via /api/v1/threat-intel/graphql.
 */

import { useState, useCallback, memo } from 'react';
import {
  Globe,
  Map,
  Archive,
  Search,
  Bitcoin,
  Hash,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Upload,
  Copy,
  Server,
  Network,
  FileText,
  Clock,
  Wallet,
  Scan,
} from 'lucide-react';
import { Panel, Input } from '@components/ui';
import { useUIStore } from '@stores/uiStore';
import { cn } from '@utils/index';

// ============================================================================
// Constants
// ============================================================================

const GRAPHQL_BASE = '/api/v1/threat-intel/graphql';

// ============================================================================
// Types
// ============================================================================

type TabId =
  | 'domain-recon'
  | 'infra-map'
  | 'domain-cluster'
  | 'wayback'
  | 'urlscan'
  | 'blockchain'
  | 'numbered-domain';

type LoadState = 'idle' | 'loading' | 'success' | 'error';

interface WhoisRecord {
  registrar?: string;
  registrant?: string;
  created?: string;
  expires?: string;
  updated?: string;
  nameservers?: string[];
  status?: string[];
}

interface DnsRecord {
  type: string;
  value: string;
  ttl?: number;
}

interface HttpHeaderRecord {
  name: string;
  value: string;
}

interface DomainReconResult {
  domain: string;
  whois: WhoisRecord;
  dns: DnsRecord[];
  headers: HttpHeaderRecord[];
  resolvedIPs: string[];
  timestamp: string;
}

interface CoHostedDomain {
  domain: string;
  ip: string;
}

interface IpWhoisRecord {
  cidr?: string;
  org?: string;
  country?: string;
  asn?: string;
  asnName?: string;
  abuse?: string;
  isp?: string;
}

interface InfraMapResult {
  ip: string;
  ipWhois: IpWhoisRecord;
  coHosted: CoHostedDomain[];
  timestamp: string;
}

interface ClusterNode {
  domain: string;
  ips: string[];
  nameservers: string[];
}

interface ClusterGroup {
  type: 'ip' | 'nameserver';
  value: string;
  domains: string[];
}

interface DomainClusterResult {
  nodes: ClusterNode[];
  groups: ClusterGroup[];
  timestamp: string;
}

interface WaybackSnapshot {
  timestamp: string;
  url: string;
  statusCode: number;
  mimeType?: string;
}

interface PageFingerprint {
  technologies: string[];
  scripts: string[];
  metaTags: Record<string, string>;
  title?: string;
  generator?: string;
  cms?: string;
  serverHeader?: string;
  poweredBy?: string;
}

interface WaybackResult {
  url: string;
  snapshots: WaybackSnapshot[];
  fingerprint: PageFingerprint;
  timestamp: string;
}

interface UrlscanResult {
  task_id: string;
  url: string;
  domain: string;
  ip?: string;
  screenshotURL?: string;
  verdicts?: { overall?: { score?: number; malicious?: boolean } };
  page?: { title?: string; country?: string; server?: string };
  submittedAt: string;
}

interface UrlscanDrilldown {
  task_id: string;
  requests: Array<{ url: string; type: string; size?: number; status?: number }>;
  cookies: Array<{ name: string; value: string; domain: string }>;
  globals: string[];
  links: string[];
}

type Chain = 'ETH' | 'BSC' | 'POLYGON';

interface BlockchainTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: string;
  type?: string;
  gasUsed?: string;
}

interface WalletInfo {
  address: string;
  chain: Chain;
  balance: string;
  symbol: string;
  txCount: number;
  firstSeen?: string;
  lastSeen?: string;
}

interface BlockchainResult {
  address: string;
  wallets: WalletInfo[];
  transactions: BlockchainTransaction[];
  drainTransactions: BlockchainTransaction[];
  relatedAddresses: string[];
  timestamp: string;
}

interface NumberedDomainEntry {
  domain: string;
  registered: boolean;
  active: boolean;
  ip?: string;
  statusCode?: number;
}

interface NumberedDomainResult {
  prefix: string;
  suffix: string;
  range: [number, number];
  entries: NumberedDomainEntry[];
  timestamp: string;
}

interface PushState {
  state: LoadState;
  createdIds: string[];
}

// ============================================================================
// OpenCTI GraphQL Helper
// ============================================================================

async function octiGraphql<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(GRAPHQL_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

// ============================================================================
// Public API Helpers
// ============================================================================

async function fetchDomainRecon(domain: string): Promise<DomainReconResult> {
  const [whoisRes, dnsRes, headersRes] = await Promise.allSettled([
    fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { signal: AbortSignal.timeout(10_000) }),
    fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=ANY`, { signal: AbortSignal.timeout(10_000) }),
    fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(`http://${domain}`)}`, { signal: AbortSignal.timeout(10_000) }),
  ]);

  let whois: WhoisRecord = {};
  if (whoisRes.status === 'fulfilled' && whoisRes.value.ok) {
    try {
      const rdap = await whoisRes.value.json();
      whois = {
        registrar: rdap.entities?.find((e: Record<string, unknown>) => (e.roles as string[])?.includes('registrar'))?.handle as string | undefined,
        created: (rdap.events as Array<{ eventAction: string; eventDate: string }>)?.find((e) => e.eventAction === 'registration')?.eventDate,
        expires: (rdap.events as Array<{ eventAction: string; eventDate: string }>)?.find((e) => e.eventAction === 'expiration')?.eventDate,
        updated: (rdap.events as Array<{ eventAction: string; eventDate: string }>)?.find((e) => e.eventAction === 'last changed')?.eventDate,
        nameservers: (rdap.nameservers as Array<{ ldhName?: string }>)?.map((ns) => ns.ldhName ?? '').filter(Boolean),
        status: rdap.status as string[] ?? [],
      };
    } catch { /* keep empty */ }
  }

  const dnsRecords: DnsRecord[] = [];
  const resolvedIPs: string[] = [];
  if (dnsRes.status === 'fulfilled' && dnsRes.value.ok) {
    try {
      const dnsData = await dnsRes.value.json();
      const typeMap: Record<number, string> = { 1: 'A', 28: 'AAAA', 2: 'NS', 5: 'CNAME', 15: 'MX', 16: 'TXT', 33: 'SRV' };
      for (const answer of (dnsData.Answer ?? []) as Array<{ type: number; data: string; TTL: number }>) {
        const rType = typeMap[answer.type] ?? String(answer.type);
        dnsRecords.push({ type: rType, value: answer.data, ttl: answer.TTL });
        if (answer.type === 1) resolvedIPs.push(answer.data);
      }
      if (!resolvedIPs.length) {
        const aRes = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`, { signal: AbortSignal.timeout(8_000) });
        if (aRes.ok) {
          const aData = await aRes.json();
          for (const a of (aData.Answer ?? []) as Array<{ type: number; data: string; TTL: number }>) {
            if (a.type === 1) {
              resolvedIPs.push(a.data);
              dnsRecords.push({ type: 'A', value: a.data, ttl: a.TTL });
            }
          }
        }
      }
    } catch { /* keep empty */ }
  }

  const headers: HttpHeaderRecord[] = [];
  if (headersRes.status === 'fulfilled' && headersRes.value.ok) {
    try {
      const proxyData = await headersRes.value.json();
      if (proxyData.status?.http_code) {
        headers.push({ name: 'X-Proxy-Status', value: String(proxyData.status.http_code) });
      }
    } catch { /* keep empty */ }
  }

  return { domain, whois, dns: dnsRecords, headers, resolvedIPs, timestamp: new Date().toISOString() };
}

async function fetchInfraMap(ip: string): Promise<InfraMapResult> {
  const [ipWhoisRes, viewDnsRes] = await Promise.allSettled([
    fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(10_000) }),
    fetch(`https://api.hackertarget.com/reverseiplookup/?q=${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(15_000) }),
  ]);

  let ipWhois: IpWhoisRecord = {};
  if (ipWhoisRes.status === 'fulfilled' && ipWhoisRes.value.ok) {
    try {
      const d = await ipWhoisRes.value.json();
      ipWhois = {
        cidr: d.connection?.cidr as string | undefined,
        org: (d.org ?? d.connection?.org) as string | undefined,
        country: d.country as string | undefined,
        asn: d.connection?.asn ? `AS${d.connection.asn}` : undefined,
        asnName: d.connection?.isp as string | undefined,
        isp: d.connection?.isp as string | undefined,
      };
    } catch { /* keep empty */ }
  }

  const coHosted: CoHostedDomain[] = [];
  if (viewDnsRes.status === 'fulfilled' && viewDnsRes.value.ok) {
    try {
      const text = await viewDnsRes.value.text();
      if (!text.startsWith('error') && !text.startsWith('API')) {
        for (const line of text.split('\n')) {
          const d = line.trim();
          if (d && d !== ip) coHosted.push({ domain: d, ip });
        }
      }
    } catch { /* keep empty */ }
  }

  return { ip, ipWhois, coHosted, timestamp: new Date().toISOString() };
}

async function fetchDomainCluster(domains: string[]): Promise<DomainClusterResult> {
  const nodes: ClusterNode[] = [];

  await Promise.all(
    domains.map(async (domain) => {
      const ips: string[] = [];
      const nameservers: string[] = [];
      try {
        const aRes = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`, { signal: AbortSignal.timeout(10_000) });
        if (aRes.ok) {
          const data = await aRes.json();
          for (const a of (data.Answer ?? []) as Array<{ type: number; data: string }>) if (a.type === 1) ips.push(a.data);
        }
        const nsRes = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=NS`, { signal: AbortSignal.timeout(10_000) });
        if (nsRes.ok) {
          const data = await nsRes.json();
          for (const ns of (data.Answer ?? []) as Array<{ type: number; data: string }>) if (ns.type === 2) nameservers.push(ns.data);
        }
      } catch { /* skip */ }
      nodes.push({ domain, ips, nameservers });
    })
  );

  const ipMap: Map<string, string[]> = new Map();
  const nsMap: Map<string, string[]> = new Map();

  for (const node of nodes) {
    for (const ip of node.ips) {
      if (!ipMap.has(ip)) ipMap.set(ip, []);
      ipMap.get(ip)!.push(node.domain);
    }
    for (const ns of node.nameservers) {
      const nsKey = ns.replace(/\.$/, '');
      if (!nsMap.has(nsKey)) nsMap.set(nsKey, []);
      nsMap.get(nsKey)!.push(node.domain);
    }
  }

  const groups: ClusterGroup[] = [];
  for (const [ip, doms] of ipMap) {
    if (doms.length > 1) groups.push({ type: 'ip', value: ip, domains: doms });
  }
  for (const [ns, doms] of nsMap) {
    if (doms.length > 1) groups.push({ type: 'nameserver', value: ns, domains: doms });
  }

  return { nodes, groups, timestamp: new Date().toISOString() };
}

async function fetchWayback(url: string): Promise<WaybackResult> {
  const [cdxRes] = await Promise.allSettled([
    fetch(
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&limit=20&fl=timestamp,original,statuscode,mimetype&collapse=digest&from=20200101`,
      { signal: AbortSignal.timeout(20_000) }
    ),
  ]);

  const snapshots: WaybackSnapshot[] = [];
  if (cdxRes.status === 'fulfilled' && cdxRes.value.ok) {
    try {
      const rows: string[][] = await cdxRes.value.json();
      for (const row of rows.slice(1)) {
        snapshots.push({
          timestamp: row[0],
          url: `https://web.archive.org/web/${row[0]}/${row[1]}`,
          statusCode: parseInt(row[2], 10) || 200,
          mimeType: row[3],
        });
      }
    } catch { /* keep empty */ }
  }

  const fingerprint: PageFingerprint = { technologies: [], scripts: [], metaTags: {} };
  try {
    const fpRes = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(15_000) });
    if (fpRes.ok) {
      const fpData = await fpRes.json();
      const html: string = fpData.contents ?? '';

      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) fingerprint.title = titleMatch[1].trim();

      const metaRe = /<meta\s+(?:name|property)=["']([^"']+)["']\s+content=["']([^"']+)["']/gi;
      let mm: RegExpExecArray | null;
      while ((mm = metaRe.exec(html)) !== null) {
        fingerprint.metaTags[mm[1]] = mm[2];
      }

      const scriptRe = /<script[^>]+src=["']([^"']+)["']/gi;
      let sm: RegExpExecArray | null;
      while ((sm = scriptRe.exec(html)) !== null) {
        fingerprint.scripts.push(sm[1]);
      }

      const gen = html.match(/generator['"] content=['"]([^'"]+)/i);
      if (gen) fingerprint.generator = gen[1];

      if (html.includes('/wp-content/')) fingerprint.cms = 'WordPress';
      else if (html.includes('/components/com_')) fingerprint.cms = 'Joomla';
      else if (html.includes('Drupal')) fingerprint.cms = 'Drupal';

      if (html.includes('React')) fingerprint.technologies.push('React');
      if (html.includes('angular')) fingerprint.technologies.push('Angular');
      if (html.includes('vue')) fingerprint.technologies.push('Vue.js');
      if (html.includes('jquery')) fingerprint.technologies.push('jQuery');
      if (html.includes('bootstrap')) fingerprint.technologies.push('Bootstrap');
      if (html.includes('shopify')) fingerprint.technologies.push('Shopify');
      if (html.includes('woocommerce')) fingerprint.technologies.push('WooCommerce');
    }
  } catch { /* skip fingerprint */ }

  return { url, snapshots, fingerprint, timestamp: new Date().toISOString() };
}

async function fetchUrlscan(query: string): Promise<UrlscanResult[]> {
  const res = await fetch(
    `https://urlscan.io/api/v1/search/?q=${encodeURIComponent(query)}&size=20`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) throw new Error(`urlscan.io returned HTTP ${res.status}`);
  const json = await res.json();
  return (json.results ?? []).map((r: Record<string, unknown>) => ({
    task_id: (r.task as Record<string, string>)?.uuid ?? (r as Record<string, string>)._id,
    url: (r.page as Record<string, string>)?.url ?? (r.task as Record<string, string>)?.url,
    domain: (r.page as Record<string, string>)?.domain ?? (r.task as Record<string, string>)?.domain,
    ip: (r.page as Record<string, string>)?.ip,
    screenshotURL: r.screenshot as string | undefined,
    verdicts: r.verdicts as UrlscanResult['verdicts'],
    page: r.page as UrlscanResult['page'],
    submittedAt: (r.task as Record<string, string>)?.time ?? (r.task as Record<string, string>)?.submitted,
  }));
}

async function fetchUrlscanDrilldown(taskId: string): Promise<UrlscanDrilldown> {
  const res = await fetch(`https://urlscan.io/api/v1/result/${taskId}/`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`urlscan.io result HTTP ${res.status}`);
  const json = await res.json();
  return {
    task_id: taskId,
    requests: (json.data?.requests ?? []).slice(0, 50).map((r: Record<string, Record<string, unknown>>) => ({
      url: (r.request?.documentURL ?? r.request?.url ?? '') as string,
      type: (r.request?.resourceType ?? 'document') as string,
      size: r.response?.response ? (r.response.response as Record<string, number>).encodedDataLength : undefined,
      status: r.response?.response ? (r.response.response as Record<string, number>).status : undefined,
    })),
    cookies: (json.data?.cookies ?? []).slice(0, 30).map((c: Record<string, string>) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
    })),
    globals: (json.data?.globals ?? []).slice(0, 30).map((g: Record<string, unknown>) => (g.prop ?? String(g)) as string),
    links: (json.lists?.urls ?? []).slice(0, 40) as string[],
  };
}

async function fetchBlockchain(address: string, chains: Chain[]): Promise<BlockchainResult> {
  const wallets: WalletInfo[] = [];
  const allTxns: BlockchainTransaction[] = [];
  const drainTxns: BlockchainTransaction[] = [];
  const relatedSet: Set<string> = new Set();

  const CHAIN_CONFIG: Record<Chain, { apiUrl: string; symbol: string }> = {
    ETH: { apiUrl: 'https://api.etherscan.io/api', symbol: 'ETH' },
    BSC: { apiUrl: 'https://api.bscscan.com/api', symbol: 'BNB' },
    POLYGON: { apiUrl: 'https://api.polygonscan.com/api', symbol: 'MATIC' },
  };

  await Promise.all(
    chains.map(async (chain) => {
      const { apiUrl, symbol } = CHAIN_CONFIG[chain];
      try {
        const balRes = await fetch(
          `${apiUrl}?module=account&action=balance&address=${address}&tag=latest`,
          { signal: AbortSignal.timeout(12_000) }
        );
        if (!balRes.ok) return;
        const balData = await balRes.json();
        const rawBalance = Number(balData.result ?? 0);
        const balance = (rawBalance / 1e18).toFixed(6);

        const txRes = await fetch(
          `${apiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&offset=50&page=1`,
          { signal: AbortSignal.timeout(12_000) }
        );
        const txData = txRes.ok ? await txRes.json() : { result: [] };
        const txList: BlockchainTransaction[] = (txData.result ?? []).map((tx: Record<string, string>) => {
          const valueEth = (parseInt(tx.value ?? '0', 10) / 1e18).toFixed(6);
          return {
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: `${valueEth} ${symbol}`,
            timestamp: new Date(parseInt(tx.timeStamp, 10) * 1000).toISOString(),
            type: tx.functionName ? tx.functionName.split('(')[0] : 'transfer',
            gasUsed: tx.gasUsed,
          };
        });

        const internalRes = await fetch(
          `${apiUrl}?module=account&action=tokentx&address=${address}&sort=desc&offset=30&page=1`,
          { signal: AbortSignal.timeout(12_000) }
        );
        const internalData = internalRes.ok ? await internalRes.json() : { result: [] };
        const drains: BlockchainTransaction[] = (internalData.result ?? [])
          .filter((tx: Record<string, string>) => tx.from?.toLowerCase() !== address.toLowerCase() && tx.to?.toLowerCase() === address.toLowerCase())
          .slice(0, 20)
          .map((tx: Record<string, string>) => {
            const decimals = parseInt(tx.tokenDecimal ?? '18', 10);
            const valueToken = (parseInt(tx.value ?? '0', 10) / Math.pow(10, decimals)).toFixed(4);
            return {
              hash: tx.hash,
              from: tx.from,
              to: tx.to,
              value: `${valueToken} ${tx.tokenSymbol ?? 'TOKEN'}`,
              timestamp: new Date(parseInt(tx.timeStamp, 10) * 1000).toISOString(),
              type: 'transferFrom (drain candidate)',
            };
          });

        for (const tx of [...txList, ...drains]) {
          if (tx.from && tx.from.toLowerCase() !== address.toLowerCase()) relatedSet.add(tx.from);
          if (tx.to && tx.to.toLowerCase() !== address.toLowerCase()) relatedSet.add(tx.to);
        }

        wallets.push({
          address,
          chain,
          balance,
          symbol,
          txCount: txList.length,
          firstSeen: txList.length ? txList[txList.length - 1].timestamp : undefined,
          lastSeen: txList.length ? txList[0].timestamp : undefined,
        });

        allTxns.push(...txList);
        drainTxns.push(...drains);
      } catch { /* skip chain */ }
    })
  );

  return {
    address,
    wallets,
    transactions: allTxns,
    drainTransactions: drainTxns,
    relatedAddresses: Array.from(relatedSet).slice(0, 20),
    timestamp: new Date().toISOString(),
  };
}

async function fetchNumberedDomainScan(
  prefix: string,
  suffix: string,
  from: number,
  to: number
): Promise<NumberedDomainResult> {
  const BATCH = 10;
  const allEntries: NumberedDomainEntry[] = [];

  const nums: number[] = [];
  for (let i = from; i <= to; i++) nums.push(i);

  for (let b = 0; b < nums.length; b += BATCH) {
    const batch = nums.slice(b, b + BATCH);
    await Promise.all(
      batch.map(async (n) => {
        const domain = `${prefix}${n}${suffix}`;
        let registered = false;
        let active = false;
        let ip: string | undefined;
        let statusCode: number | undefined;
        try {
          const dnsRes = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`, { signal: AbortSignal.timeout(8_000) });
          if (dnsRes.ok) {
            const data = await dnsRes.json();
            const aRecords = (data.Answer ?? []).filter((a: Record<string, number>) => a.type === 1);
            if (aRecords.length > 0) {
              registered = true;
              ip = (aRecords[0] as Record<string, string>).data;
              try {
                const probeRes = await fetch(
                  `https://api.allorigins.win/get?url=${encodeURIComponent(`http://${domain}`)}`,
                  { signal: AbortSignal.timeout(8_000) }
                );
                if (probeRes.ok) {
                  const pd = await probeRes.json();
                  statusCode = pd.status?.http_code as number | undefined;
                  active = !!statusCode && statusCode < 500;
                }
              } catch { /* no http response */ }
            }
          }
        } catch { /* DNS failed */ }
        allEntries.push({ domain, registered, active, ip, statusCode });
      })
    );
  }

  return {
    prefix,
    suffix,
    range: [from, to],
    entries: allEntries.sort((a, b) => {
      const na = parseInt(a.domain.slice(prefix.length), 10);
      const nb = parseInt(b.domain.slice(prefix.length), 10);
      return na - nb;
    }),
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// OpenCTI Push Functions
// ============================================================================

async function pushDomainToOpenCTI(domain: string): Promise<string> {
  const mutation = `
    mutation CreateDomainObservable($input: DomainNameAddInput!) {
      domainNameAdd(input: $input) {
        id
      }
    }
  `;
  const data = await octiGraphql<{ domainNameAdd: { id: string } }>(mutation, {
    input: { value: domain },
  });
  return data.domainNameAdd.id;
}

async function pushIPToOpenCTI(ip: string): Promise<string> {
  const mutation = `
    mutation CreateIPv4Observable($input: IPv4AddrAddInput!) {
      iPv4AddrAdd(input: $input) {
        id
      }
    }
  `;
  const data = await octiGraphql<{ iPv4AddrAdd: { id: string } }>(mutation, {
    input: { value: ip },
  });
  return data.iPv4AddrAdd.id;
}

async function pushWalletToOpenCTI(address: string): Promise<string> {
  const mutation = `
    mutation CreateCryptoWallet($input: CryptocurrencyWalletAddInput!) {
      cryptocurrencyWalletAdd(input: $input) {
        id
      }
    }
  `;
  const data = await octiGraphql<{ cryptocurrencyWalletAdd: { id: string } }>(mutation, {
    input: { value: address },
  });
  return data.cryptocurrencyWalletAdd.id;
}

async function linkObservables(fromId: string, toId: string, relationship: string): Promise<void> {
  const mutation = `
    mutation CreateRelationship($input: StixCoreRelationshipAddInput!) {
      stixCoreRelationshipAdd(input: $input) {
        id
      }
    }
  `;
  await octiGraphql(mutation, {
    input: { fromId, toId, relationship_type: relationship },
  });
}

// ============================================================================
// Shared UI Components
// ============================================================================

const TabButton = memo(function TabButton({
  id,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: (id: TabId) => void;
}) {
  return (
    <button
      onClick={() => onClick(id)}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
        active
          ? 'bg-grok-recon-blue text-white'
          : 'text-grok-text-muted hover:text-grok-text-body hover:bg-grok-hover'
      )}
      aria-pressed={active}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      {label}
    </button>
  );
});

function LoadingSpinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-grok-text-muted text-sm py-6">
      <Loader2 className="w-4 h-4 animate-spin text-grok-recon-blue" />
      {label ?? 'Running...'}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 p-3 bg-grok-surface-2 border border-grok-error rounded-md text-sm">
      <AlertTriangle className="w-4 h-4 text-grok-error flex-shrink-0 mt-0.5" />
      <span className="text-grok-error">{message}</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center text-grok-text-muted text-sm">{message}</div>
  );
}

const DataTable = memo(function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | React.ReactNode)[][];
}) {
  if (!rows.length) return <EmptyState message="No data" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-grok-border">
            {headers.map((h) => (
              <th
                key={h}
                className="text-left py-2 px-3 text-grok-text-muted uppercase tracking-wide font-semibold"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-grok-border hover:bg-grok-hover transition-colors"
            >
              {row.map((cell, ci) => (
                <td key={ci} className="py-2 px-3 text-grok-text-body font-mono">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

function PushButton({
  label,
  pushState,
  onClick,
}: {
  label: string;
  pushState: PushState;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={pushState.state === 'loading'}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
        pushState.state === 'success'
          ? 'bg-grok-loot-green/20 text-grok-loot-green border border-grok-loot-green'
          : pushState.state === 'error'
          ? 'bg-grok-error/10 text-grok-error border border-grok-error'
          : 'bg-grok-ai-purple/20 text-grok-ai-purple border border-grok-ai-purple hover:bg-grok-ai-purple/30'
      )}
    >
      {pushState.state === 'loading' ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : pushState.state === 'success' ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : pushState.state === 'error' ? (
        <XCircle className="w-3 h-3" />
      ) : (
        <Upload className="w-3 h-3" />
      )}
      {pushState.state === 'success' ? 'Pushed' : pushState.state === 'error' ? 'Failed' : label}
    </button>
  );
}

function KVRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 py-1 border-b border-grok-border last:border-0">
      <span className="text-xs text-grok-text-muted w-32 flex-shrink-0">{label}</span>
      <span className="text-xs font-mono text-grok-text-body break-all">{value}</span>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);
  return (
    <button onClick={copy} className="text-grok-text-muted hover:text-grok-scan-cyan transition-colors" aria-label="Copy">
      {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

// ============================================================================
// Tab 1: Domain Recon
// ============================================================================

function DomainReconTab() {
  const { addToast } = useUIStore();
  const [domain, setDomain] = useState('');
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<DomainReconResult | null>(null);
  const [pushState, setPushState] = useState<PushState>({ state: 'idle', createdIds: [] });

  const run = useCallback(async () => {
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!d) return;
    setLoadState('loading');
    setError('');
    setResult(null);
    try {
      const res = await fetchDomainRecon(d);
      setResult(res);
      setLoadState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recon failed');
      setLoadState('error');
    }
  }, [domain]);

  const pushToOpenCTI = useCallback(async () => {
    if (!result) return;
    setPushState({ state: 'loading', createdIds: [] });
    try {
      const ids: string[] = [];
      const domainId = await pushDomainToOpenCTI(result.domain);
      ids.push(domainId);
      for (const ip of result.resolvedIPs) {
        try {
          const ipId = await pushIPToOpenCTI(ip);
          ids.push(ipId);
          await linkObservables(domainId, ipId, 'resolves-to');
        } catch { /* skip this IP */ }
      }
      setPushState({ state: 'success', createdIds: ids });
      addToast({ type: 'success', message: `Pushed domain + ${result.resolvedIPs.length} IPs to OpenCTI` });
    } catch (err) {
      setPushState({ state: 'error', createdIds: [] });
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'OpenCTI push failed' });
    }
  }, [result, addToast]);

  return (
    <div className="space-y-4">
      <Panel title="Domain Recon">
        <div className="flex gap-2">
          <Input
            placeholder="example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            className="flex-1"
          />
          <button
            onClick={run}
            disabled={loadState === 'loading' || !domain.trim()}
            className="px-4 py-2 bg-grok-recon-blue text-white rounded-md text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loadState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
            Recon
          </button>
        </div>
        {loadState === 'loading' && <LoadingSpinner label="Running WHOIS, DNS, and HTTP probes..." />}
        {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
      </Panel>

      {result && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-grok-text-heading">
              Results for <span className="text-grok-scan-cyan font-mono">{result.domain}</span>
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-grok-text-muted">{new Date(result.timestamp).toLocaleTimeString()}</span>
              <PushButton label="Push to OpenCTI" pushState={pushState} onClick={pushToOpenCTI} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="WHOIS">
              <div>
                <KVRow label="Registrar" value={result.whois.registrar} />
                <KVRow label="Registrant" value={result.whois.registrant} />
                <KVRow label="Created" value={result.whois.created} />
                <KVRow label="Expires" value={result.whois.expires} />
                <KVRow label="Updated" value={result.whois.updated} />
                <KVRow label="Status" value={result.whois.status?.join(', ')} />
                {result.whois.nameservers?.length ? (
                  <div className="py-1">
                    <span className="text-xs text-grok-text-muted block mb-1">Nameservers</span>
                    {result.whois.nameservers.map((ns) => (
                      <div key={ns} className="flex items-center gap-1">
                        <Server className="w-3 h-3 text-grok-text-muted" />
                        <span className="text-xs font-mono text-grok-text-body">{ns}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {!Object.values(result.whois).some(Boolean) && <EmptyState message="No WHOIS data available" />}
              </div>
            </Panel>

            <Panel title="Resolved IPs">
              {result.resolvedIPs.length ? (
                <div className="space-y-1.5">
                  {result.resolvedIPs.map((ip) => (
                    <div key={ip} className="flex items-center justify-between p-2 bg-grok-surface-2 rounded border border-grok-border">
                      <div className="flex items-center gap-2">
                        <Network className="w-3 h-3 text-grok-scan-cyan" />
                        <span className="text-xs font-mono text-grok-scan-cyan">{ip}</span>
                      </div>
                      <CopyButton value={ip} />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No A records resolved" />
              )}
            </Panel>
          </div>

          <Panel title="DNS Records">
            <DataTable
              headers={['Type', 'Value', 'TTL']}
              rows={result.dns.map((r) => [r.type, r.value, r.ttl != null ? `${r.ttl}s` : '—'])}
            />
          </Panel>

          {result.headers.length > 0 && (
            <Panel title="HTTP Response Info">
              <DataTable
                headers={['Header', 'Value']}
                rows={result.headers.map((h) => [h.name, h.value])}
              />
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// Tab 2: Infrastructure Map
// ============================================================================

function InfraMapTab() {
  const { addToast } = useUIStore();
  const [ip, setIp] = useState('');
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<InfraMapResult | null>(null);
  const [pushState, setPushState] = useState<PushState>({ state: 'idle', createdIds: [] });

  const run = useCallback(async () => {
    const target = ip.trim();
    if (!target) return;
    setLoadState('loading');
    setError('');
    setResult(null);
    try {
      const res = await fetchInfraMap(target);
      setResult(res);
      setLoadState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Infra map failed');
      setLoadState('error');
    }
  }, [ip]);

  const pushToOpenCTI = useCallback(async () => {
    if (!result) return;
    setPushState({ state: 'loading', createdIds: [] });
    try {
      const ids: string[] = [];
      const ipId = await pushIPToOpenCTI(result.ip);
      ids.push(ipId);
      for (const ch of result.coHosted) {
        try {
          const domId = await pushDomainToOpenCTI(ch.domain);
          ids.push(domId);
          await linkObservables(domId, ipId, 'resolves-to');
        } catch { /* skip */ }
      }
      setPushState({ state: 'success', createdIds: ids });
      addToast({ type: 'success', message: `Pushed IP + ${result.coHosted.length} co-hosted domains to OpenCTI` });
    } catch (err) {
      setPushState({ state: 'error', createdIds: [] });
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'OpenCTI push failed' });
    }
  }, [result, addToast]);

  return (
    <div className="space-y-4">
      <Panel title="Infrastructure Map">
        <div className="flex gap-2">
          <Input
            placeholder="1.2.3.4"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            className="flex-1"
          />
          <button
            onClick={run}
            disabled={loadState === 'loading' || !ip.trim()}
            className="px-4 py-2 bg-grok-recon-blue text-white rounded-md text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loadState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Map className="w-4 h-4" />}
            Map
          </button>
        </div>
        {loadState === 'loading' && <LoadingSpinner label="Running reverse-IP lookup and IP WHOIS..." />}
        {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
      </Panel>

      {result && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-grok-text-heading">
              Results for <span className="text-grok-scan-cyan font-mono">{result.ip}</span>
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-grok-text-muted">{new Date(result.timestamp).toLocaleTimeString()}</span>
              <PushButton label="Push to OpenCTI" pushState={pushState} onClick={pushToOpenCTI} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="IP WHOIS">
              <div>
                <KVRow label="CIDR" value={result.ipWhois.cidr} />
                <KVRow label="Organization" value={result.ipWhois.org} />
                <KVRow label="ISP" value={result.ipWhois.isp} />
                <KVRow label="ASN" value={result.ipWhois.asn} />
                <KVRow label="ASN Name" value={result.ipWhois.asnName} />
                <KVRow label="Country" value={result.ipWhois.country} />
                <KVRow label="Abuse" value={result.ipWhois.abuse} />
                {!Object.values(result.ipWhois).some(Boolean) && <EmptyState message="No IP WHOIS data" />}
              </div>
            </Panel>

            <Panel title={`Co-Hosted Domains (${result.coHosted.length})`}>
              {result.coHosted.length ? (
                <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                  {result.coHosted.map((ch) => (
                    <div key={ch.domain} className="flex items-center justify-between p-2 bg-grok-surface-2 rounded border border-grok-border">
                      <div className="flex items-center gap-2">
                        <Globe className="w-3 h-3 text-grok-text-muted" />
                        <span className="text-xs font-mono text-grok-text-body">{ch.domain}</span>
                      </div>
                      <CopyButton value={ch.domain} />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No co-hosted domains found" />
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Tab 3: Domain Cluster
// ============================================================================

function DomainClusterTab() {
  const { addToast } = useUIStore();
  const [input, setInput] = useState('');
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<DomainClusterResult | null>(null);
  const [pushState, setPushState] = useState<PushState>({ state: 'idle', createdIds: [] });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const run = useCallback(async () => {
    const domains = input
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0])
      .filter(Boolean);
    if (domains.length < 2) {
      setError('Enter at least two comma-separated domains');
      return;
    }
    if (domains.length > 30) {
      setError('Maximum 30 domains per cluster analysis');
      return;
    }
    setLoadState('loading');
    setError('');
    setResult(null);
    try {
      const res = await fetchDomainCluster(domains);
      setResult(res);
      setLoadState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cluster analysis failed');
      setLoadState('error');
    }
  }, [input]);

  const pushToOpenCTI = useCallback(async () => {
    if (!result) return;
    setPushState({ state: 'loading', createdIds: [] });
    const ids: string[] = [];
    let successCount = 0;
    try {
      const domainIdMap: Map<string, string> = new Map();
      for (const node of result.nodes) {
        try {
          const id = await pushDomainToOpenCTI(node.domain);
          ids.push(id);
          domainIdMap.set(node.domain, id);
          successCount++;
        } catch { /* skip */ }
      }

      const ipIdMap: Map<string, string> = new Map();
      for (const group of result.groups) {
        if (group.type === 'ip') {
          try {
            if (!ipIdMap.has(group.value)) {
              const id = await pushIPToOpenCTI(group.value);
              ipIdMap.set(group.value, id);
              ids.push(id);
            }
            const ipId = ipIdMap.get(group.value)!;
            for (const d of group.domains) {
              const domId = domainIdMap.get(d);
              if (domId) await linkObservables(domId, ipId, 'resolves-to').catch(() => {});
            }
          } catch { /* skip */ }
        }
      }

      setPushState({ state: 'success', createdIds: ids });
      addToast({ type: 'success', message: `Pushed ${successCount} domains + shared infrastructure to OpenCTI` });
    } catch (err) {
      setPushState({ state: 'error', createdIds: [] });
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'OpenCTI push failed' });
    }
  }, [result, addToast]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <Panel title="Domain Cluster Analysis">
        <div className="space-y-2">
          <p className="text-xs text-grok-text-muted">Enter comma-separated domains to analyze shared infrastructure (IPs, nameservers).</p>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="example.com, threat-actor.net, malware-c2.org"
            rows={3}
            className="w-full px-3 py-2 bg-grok-surface-2 border border-grok-border rounded-md text-xs font-mono text-grok-text-body placeholder:text-grok-text-muted focus:outline-none focus:ring-2 focus:ring-grok-recon-blue resize-none"
          />
          <button
            onClick={run}
            disabled={loadState === 'loading' || !input.trim()}
            className="px-4 py-2 bg-grok-recon-blue text-white rounded-md text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loadState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Network className="w-4 h-4" />}
            Analyze Cluster
          </button>
        </div>
        {loadState === 'loading' && <LoadingSpinner label="Resolving DNS for all domains..." />}
        {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
      </Panel>

      {result && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-grok-text-heading">
              Cluster — {result.nodes.length} domains, {result.groups.length} shared resources
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-grok-text-muted">{new Date(result.timestamp).toLocaleTimeString()}</span>
              <PushButton label="Push All to OpenCTI" pushState={pushState} onClick={pushToOpenCTI} />
            </div>
          </div>

          {result.groups.length > 0 && (
            <Panel title="Shared Infrastructure Clusters">
              <div className="space-y-2">
                {result.groups.map((group) => {
                  const key = `${group.type}-${group.value}`;
                  const isOpen = expanded.has(key);
                  const typeColor = group.type === 'ip' ? 'text-grok-scan-cyan' : 'text-grok-ai-purple';
                  return (
                    <div key={key} className="border border-grok-border rounded-md overflow-hidden">
                      <button
                        onClick={() => toggleExpand(key)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-grok-surface-2 hover:bg-grok-hover transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          {group.type === 'ip' ? (
                            <Server className={`w-3.5 h-3.5 ${typeColor}`} />
                          ) : (
                            <Network className={`w-3.5 h-3.5 ${typeColor}`} />
                          )}
                          <span className={`text-xs font-mono font-semibold ${typeColor}`}>{group.value}</span>
                          <span className="text-xs text-grok-text-muted capitalize">({group.type})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs bg-grok-surface-3 px-1.5 py-0.5 rounded text-grok-text-muted">
                            {group.domains.length} domains
                          </span>
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4 text-grok-text-muted" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-grok-text-muted" />
                          )}
                        </div>
                      </button>
                      {isOpen && (
                        <div className="p-3 bg-grok-surface-1 flex flex-wrap gap-1.5">
                          {group.domains.map((d) => (
                            <span
                              key={d}
                              className="px-2 py-0.5 bg-grok-surface-2 border border-grok-border rounded text-xs font-mono text-grok-text-body"
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          <Panel title="Domain Nodes">
            <DataTable
              headers={['Domain', 'IPs', 'Nameservers']}
              rows={result.nodes.map((n) => [
                n.domain,
                n.ips.join(', ') || '—',
                n.nameservers.map((ns) => ns.replace(/\.$/, '')).join(', ') || '—',
              ])}
            />
          </Panel>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Tab 4: Wayback & Content
// ============================================================================

function WaybackTab() {
  const [url, setUrl] = useState('');
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<WaybackResult | null>(null);

  const run = useCallback(async () => {
    const target = url.trim();
    if (!target) return;
    const normalized = target.startsWith('http') ? target : `http://${target}`;
    setLoadState('loading');
    setError('');
    setResult(null);
    try {
      const res = await fetchWayback(normalized);
      setResult(res);
      setLoadState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wayback query failed');
      setLoadState('error');
    }
  }, [url]);

  return (
    <div className="space-y-4">
      <Panel title="Wayback Machine & Content Fingerprint">
        <div className="flex gap-2">
          <Input
            placeholder="https://example.com/page"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            className="flex-1"
          />
          <button
            onClick={run}
            disabled={loadState === 'loading' || !url.trim()}
            className="px-4 py-2 bg-grok-recon-blue text-white rounded-md text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loadState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
            Fetch
          </button>
        </div>
        {loadState === 'loading' && <LoadingSpinner label="Querying Wayback CDX API and fingerprinting page..." />}
        {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
      </Panel>

      {result && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-grok-text-heading truncate max-w-lg">
              <span className="text-grok-text-muted">URL:</span>{' '}
              <span className="text-grok-scan-cyan font-mono text-xs">{result.url}</span>
            </h3>
            <span className="text-xs text-grok-text-muted flex-shrink-0">{new Date(result.timestamp).toLocaleTimeString()}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Page Fingerprint">
              <div>
                <KVRow label="Title" value={result.fingerprint.title} />
                <KVRow label="CMS" value={result.fingerprint.cms} />
                <KVRow label="Generator" value={result.fingerprint.generator} />
                <KVRow label="Server" value={result.fingerprint.serverHeader} />
                <KVRow label="Powered By" value={result.fingerprint.poweredBy} />
                {Object.entries(result.fingerprint.metaTags).slice(0, 6).map(([k, v]) => (
                  <KVRow key={k} label={`meta:${k}`} value={v} />
                ))}
                {result.fingerprint.technologies.length > 0 && (
                  <div className="py-1">
                    <span className="text-xs text-grok-text-muted block mb-1">Technologies</span>
                    <div className="flex flex-wrap gap-1">
                      {result.fingerprint.technologies.map((t) => (
                        <span key={t} className="px-2 py-0.5 bg-grok-surface-3 rounded text-xs font-mono text-grok-scan-cyan border border-grok-border">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Panel>

            <Panel title={`Scripts (${result.fingerprint.scripts.length})`}>
              {result.fingerprint.scripts.length ? (
                <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                  {result.fingerprint.scripts.slice(0, 30).map((src, i) => (
                    <div key={i} className="flex items-start gap-1.5 p-1.5 bg-grok-surface-2 rounded text-xs font-mono">
                      <FileText className="w-3 h-3 text-grok-text-muted flex-shrink-0 mt-0.5" />
                      <span className="text-grok-text-body break-all">{src}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No external scripts detected" />
              )}
            </Panel>
          </div>

          <Panel title={`Wayback Snapshots (${result.snapshots.length})`}>
            {result.snapshots.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-grok-border">
                      <th className="text-left py-2 px-3 text-grok-text-muted uppercase tracking-wide font-semibold">Timestamp</th>
                      <th className="text-left py-2 px-3 text-grok-text-muted uppercase tracking-wide font-semibold">Status</th>
                      <th className="text-left py-2 px-3 text-grok-text-muted uppercase tracking-wide font-semibold">MIME</th>
                      <th className="text-left py-2 px-3 text-grok-text-muted uppercase tracking-wide font-semibold">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.snapshots.map((snap, i) => {
                      const ts = snap.timestamp;
                      const formatted = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}`;
                      const statusOk = snap.statusCode >= 200 && snap.statusCode < 300;
                      return (
                        <tr key={i} className="border-b border-grok-border hover:bg-grok-hover transition-colors">
                          <td className="py-2 px-3 font-mono text-grok-text-body">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-grok-text-muted" />
                              {formatted}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <span className={cn('font-mono font-semibold', statusOk ? 'text-grok-loot-green' : 'text-grok-error')}>
                              {snap.statusCode}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-grok-text-muted">{snap.mimeType ?? '—'}</td>
                          <td className="py-2 px-3">
                            <a
                              href={snap.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-grok-recon-blue hover:underline"
                            >
                              <ExternalLink className="w-3 h-3" />
                              View
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState message="No Wayback Machine snapshots found for this URL" />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Tab 5: urlscan.io
// ============================================================================

function UrlscanTab() {
  const { addToast } = useUIStore();
  const [query, setQuery] = useState('');
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState('');
  const [results, setResults] = useState<UrlscanResult[]>([]);
  const [drilldown, setDrilldown] = useState<UrlscanDrilldown | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [activeDrillId, setActiveDrillId] = useState<string | null>(null);
  const [drillTab, setDrillTab] = useState<'requests' | 'cookies' | 'globals' | 'links'>('requests');

  const run = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoadState('loading');
    setError('');
    setResults([]);
    setDrilldown(null);
    setActiveDrillId(null);
    try {
      const res = await fetchUrlscan(q);
      setResults(res);
      setLoadState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'urlscan.io query failed');
      setLoadState('error');
    }
  }, [query]);

  const loadDrilldown = useCallback(async (taskId: string) => {
    if (activeDrillId === taskId) {
      setActiveDrillId(null);
      setDrilldown(null);
      return;
    }
    setActiveDrillId(taskId);
    setDrilldown(null);
    setDrilldownLoading(true);
    try {
      const dd = await fetchUrlscanDrilldown(taskId);
      setDrilldown(dd);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to load drilldown' });
      setActiveDrillId(null);
    } finally {
      setDrilldownLoading(false);
    }
  }, [activeDrillId, addToast]);

  return (
    <div className="space-y-4">
      <Panel title="urlscan.io Search">
        <div className="space-y-2">
          <p className="text-xs text-grok-text-muted">
            Use urlscan.io query syntax:{' '}
            <code className="font-mono bg-grok-surface-3 px-1 rounded">domain:example.com</code>
            {' '}<code className="font-mono bg-grok-surface-3 px-1 rounded">ip:1.2.3.4</code>
            {' '}<code className="font-mono bg-grok-surface-3 px-1 rounded">page.title:"login"</code>
          </p>
          <div className="flex gap-2">
            <Input
              placeholder='domain:example.com'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              className="flex-1"
            />
            <button
              onClick={run}
              disabled={loadState === 'loading' || !query.trim()}
              className="px-4 py-2 bg-grok-recon-blue text-white rounded-md text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loadState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search
            </button>
          </div>
        </div>
        {loadState === 'loading' && <LoadingSpinner label="Querying urlscan.io..." />}
        {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
      </Panel>

      {results.length > 0 && (
        <Panel title={`Results (${results.length})`} noPadding>
          <div className="divide-y divide-grok-border">
            {results.map((r) => {
              const isActive = activeDrillId === r.task_id;
              const score = r.verdicts?.overall?.score ?? 0;
              const malicious = r.verdicts?.overall?.malicious ?? false;
              return (
                <div key={r.task_id}>
                  <div
                    className={cn(
                      'flex items-start gap-3 p-3 hover:bg-grok-hover transition-colors cursor-pointer',
                      isActive && 'bg-grok-hover'
                    )}
                    onClick={() => loadDrilldown(r.task_id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && loadDrilldown(r.task_id)}
                    aria-expanded={isActive}
                  >
                    {r.screenshotURL && (
                      <img
                        src={r.screenshotURL}
                        alt={`Screenshot of ${r.domain}`}
                        className="w-20 h-14 object-cover rounded border border-grok-border flex-shrink-0"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-mono font-semibold text-grok-text-heading truncate">{r.domain}</span>
                        {malicious && (
                          <span className="px-1.5 py-0.5 bg-grok-error/20 text-grok-error text-xs rounded border border-grok-error font-semibold">
                            MALICIOUS
                          </span>
                        )}
                        {score > 0 && (
                          <span className={cn(
                            'px-1.5 py-0.5 text-xs rounded font-mono',
                            score >= 70 ? 'bg-grok-error/20 text-grok-error' :
                            score >= 40 ? 'bg-grok-warning/20 text-grok-warning' :
                            'bg-grok-surface-3 text-grok-text-muted'
                          )}>
                            {score}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-grok-text-muted truncate">{r.url}</p>
                      <div className="flex items-center gap-3 mt-1">
                        {r.ip && <span className="text-xs font-mono text-grok-scan-cyan">{r.ip}</span>}
                        {r.page?.country && <span className="text-xs text-grok-text-muted">{r.page.country}</span>}
                        {r.page?.server && <span className="text-xs text-grok-text-muted">{r.page.server}</span>}
                        <span className="text-xs text-grok-text-muted">{r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : ''}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <a
                        href={`https://urlscan.io/result/${r.task_id}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-grok-recon-blue hover:text-blue-400 transition-colors"
                        aria-label="Open in urlscan.io"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      {isActive ? (
                        <ChevronDown className="w-4 h-4 text-grok-text-muted" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-grok-text-muted" />
                      )}
                    </div>
                  </div>

                  {isActive && (
                    <div className="bg-grok-surface-1 border-t border-grok-border p-4">
                      {drilldownLoading && <LoadingSpinner label="Loading scan details..." />}
                      {drilldown && drilldown.task_id === r.task_id && (
                        <div>
                          <div className="flex gap-1 mb-3">
                            {(['requests', 'cookies', 'globals', 'links'] as const).map((t) => (
                              <button
                                key={t}
                                onClick={() => setDrillTab(t)}
                                className={cn(
                                  'px-2.5 py-1 rounded text-xs font-medium transition-colors capitalize',
                                  drillTab === t
                                    ? 'bg-grok-recon-blue text-white'
                                    : 'text-grok-text-muted hover:text-grok-text-body hover:bg-grok-hover'
                                )}
                              >
                                {t} ({
                                  t === 'requests' ? drilldown.requests.length :
                                  t === 'cookies' ? drilldown.cookies.length :
                                  t === 'globals' ? drilldown.globals.length :
                                  drilldown.links.length
                                })
                              </button>
                            ))}
                          </div>

                          {drillTab === 'requests' && (
                            <DataTable
                              headers={['URL', 'Type', 'Status', 'Size']}
                              rows={drilldown.requests.map((req) => [
                                <span key={req.url} className="truncate max-w-xs block">{req.url}</span>,
                                req.type,
                                req.status ? String(req.status) : '—',
                                req.size ? `${(req.size / 1024).toFixed(1)}KB` : '—',
                              ])}
                            />
                          )}
                          {drillTab === 'cookies' && (
                            <DataTable
                              headers={['Name', 'Domain', 'Value (truncated)']}
                              rows={drilldown.cookies.map((c) => [
                                c.name,
                                c.domain,
                                c.value.slice(0, 60) + (c.value.length > 60 ? '…' : ''),
                              ])}
                            />
                          )}
                          {drillTab === 'globals' && (
                            <div className="flex flex-wrap gap-1.5">
                              {drilldown.globals.map((g, i) => (
                                <span key={i} className="px-2 py-0.5 bg-grok-surface-2 border border-grok-border rounded text-xs font-mono text-grok-text-body">
                                  {g}
                                </span>
                              ))}
                              {!drilldown.globals.length && <EmptyState message="No globals captured" />}
                            </div>
                          )}
                          {drillTab === 'links' && (
                            <div className="space-y-1 max-h-60 overflow-y-auto">
                              {drilldown.links.map((link, i) => (
                                <div key={i} className="flex items-center justify-between p-1.5 bg-grok-surface-2 rounded">
                                  <span className="text-xs font-mono text-grok-text-body truncate flex-1 mr-2">{link}</span>
                                  <a
                                    href={link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-grok-recon-blue flex-shrink-0"
                                    aria-label="Open link"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </div>
                              ))}
                              {!drilldown.links.length && <EmptyState message="No links extracted" />}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}
      {loadState === 'success' && results.length === 0 && (
        <EmptyState message="No urlscan.io results for this query" />
      )}
    </div>
  );
}

// ============================================================================
// Tab 6: Blockchain
// ============================================================================

function BlockchainTab() {
  const { addToast } = useUIStore();
  const [address, setAddress] = useState('');
  const [selectedChains, setSelectedChains] = useState<Set<Chain>>(new Set(['ETH', 'BSC', 'POLYGON']));
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<BlockchainResult | null>(null);
  const [pushState, setPushState] = useState<PushState>({ state: 'idle', createdIds: [] });
  const [activeSection, setActiveSection] = useState<'wallets' | 'txns' | 'drains' | 'related'>('wallets');

  const toggleChain = (chain: Chain) => {
    setSelectedChains((prev) => {
      const next = new Set(prev);
      if (next.has(chain)) {
        if (next.size === 1) return prev;
        next.delete(chain);
      } else {
        next.add(chain);
      }
      return next;
    });
  };

  const run = useCallback(async () => {
    const addr = address.trim();
    if (!addr) return;
    if (!addr.startsWith('0x') || addr.length !== 42) {
      setError('Enter a valid EVM wallet address (0x...)');
      return;
    }
    setLoadState('loading');
    setError('');
    setResult(null);
    try {
      const res = await fetchBlockchain(addr, Array.from(selectedChains));
      setResult(res);
      setLoadState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Blockchain lookup failed');
      setLoadState('error');
    }
  }, [address, selectedChains]);

  const pushToOpenCTI = useCallback(async () => {
    if (!result) return;
    setPushState({ state: 'loading', createdIds: [] });
    try {
      const mainId = await pushWalletToOpenCTI(result.address);
      const ids = [mainId];
      for (const related of result.relatedAddresses.slice(0, 10)) {
        try {
          const id = await pushWalletToOpenCTI(related);
          ids.push(id);
          await linkObservables(mainId, id, 'related-to').catch(() => {});
        } catch { /* skip */ }
      }
      setPushState({ state: 'success', createdIds: ids });
      addToast({ type: 'success', message: `Pushed wallet + ${result.relatedAddresses.slice(0, 10).length} related addresses to OpenCTI` });
    } catch (err) {
      setPushState({ state: 'error', createdIds: [] });
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'OpenCTI push failed' });
    }
  }, [result, addToast]);

  const CHAINS: Chain[] = ['ETH', 'BSC', 'POLYGON'];

  return (
    <div className="space-y-4">
      <Panel title="Blockchain Wallet Tracer">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="0xabcdef1234567890abcdef1234567890abcdef12"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              className="flex-1 font-mono"
            />
            <button
              onClick={run}
              disabled={loadState === 'loading' || !address.trim()}
              className="px-4 py-2 bg-grok-recon-blue text-white rounded-md text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2 flex-shrink-0"
            >
              {loadState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
              Trace
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-grok-text-muted">Chains:</span>
            {CHAINS.map((chain) => (
              <button
                key={chain}
                onClick={() => toggleChain(chain)}
                className={cn(
                  'px-2.5 py-1 rounded border text-xs font-semibold transition-colors',
                  selectedChains.has(chain)
                    ? 'border-grok-recon-blue bg-grok-recon-blue/20 text-grok-scan-cyan'
                    : 'border-grok-border text-grok-text-muted hover:border-grok-border-glow'
                )}
                aria-pressed={selectedChains.has(chain)}
              >
                {chain}
              </button>
            ))}
          </div>
          <p className="text-xs text-grok-text-muted">
            Note: Blockchain explorers use public rate-limited APIs. Results may be partial without a registered API key configured server-side.
          </p>
        </div>
        {loadState === 'loading' && <LoadingSpinner label="Querying blockchain explorers..." />}
        {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
      </Panel>

      {result && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-grok-text-heading">
              <span className="text-grok-scan-cyan font-mono text-xs">{result.address}</span>
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-grok-text-muted">{new Date(result.timestamp).toLocaleTimeString()}</span>
              <PushButton label="Push to OpenCTI" pushState={pushState} onClick={pushToOpenCTI} />
            </div>
          </div>

          <div className="flex gap-1 flex-wrap">
            {(['wallets', 'txns', 'drains', 'related'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setActiveSection(s)}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-medium transition-colors',
                  activeSection === s
                    ? 'bg-grok-recon-blue text-white'
                    : 'text-grok-text-muted hover:text-grok-text-body hover:bg-grok-hover'
                )}
                aria-pressed={activeSection === s}
              >
                {s === 'txns' ? 'Transactions' : s === 'drains' ? 'Drain Candidates' : s === 'related' ? 'Related Addresses' : 'Wallets'}
                {' '}
                ({
                  s === 'wallets' ? result.wallets.length :
                  s === 'txns' ? result.transactions.length :
                  s === 'drains' ? result.drainTransactions.length :
                  result.relatedAddresses.length
                })
              </button>
            ))}
          </div>

          {activeSection === 'wallets' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {result.wallets.map((w) => (
                <Panel key={w.chain} title={w.chain}>
                  <div>
                    <div className="text-2xl font-mono font-bold text-grok-text-heading mb-1">
                      {w.balance} <span className="text-sm text-grok-text-muted">{w.symbol}</span>
                    </div>
                    <KVRow label="Transactions" value={String(w.txCount)} />
                    <KVRow label="First seen" value={w.firstSeen ? new Date(w.firstSeen).toLocaleDateString() : undefined} />
                    <KVRow label="Last seen" value={w.lastSeen ? new Date(w.lastSeen).toLocaleDateString() : undefined} />
                  </div>
                </Panel>
              ))}
              {result.wallets.length === 0 && (
                <div className="col-span-3">
                  <EmptyState message="No wallet data returned — blockchain explorers may require an API key or rate limit was hit" />
                </div>
              )}
            </div>
          )}

          {activeSection === 'txns' && (
            <Panel title="Transactions">
              <DataTable
                headers={['Hash', 'From', 'To', 'Value', 'Type', 'Date']}
                rows={result.transactions.map((tx) => [
                  <div key={tx.hash} className="flex items-center gap-1">
                    <span className="truncate w-24">{tx.hash.slice(0, 10)}...</span>
                    <CopyButton value={tx.hash} />
                  </div>,
                  <span key={tx.from} className={cn('truncate w-20 block', tx.from.toLowerCase() === result.address.toLowerCase() ? 'text-grok-error' : 'text-grok-text-body')}>{tx.from.slice(0, 8)}...</span>,
                  <span key={tx.to} className={cn('truncate w-20 block', tx.to?.toLowerCase() === result.address.toLowerCase() ? 'text-grok-loot-green' : 'text-grok-text-body')}>{tx.to ? `${tx.to.slice(0, 8)}...` : '—'}</span>,
                  tx.value,
                  tx.type ?? '—',
                  new Date(tx.timestamp).toLocaleDateString(),
                ])}
              />
            </Panel>
          )}

          {activeSection === 'drains' && (
            <Panel title="TransferFrom Drain Candidates">
              {result.drainTransactions.length > 0 && (
                <div className="mb-3 p-2.5 bg-grok-warning/10 border border-grok-warning rounded-md text-xs text-grok-warning">
                  <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                  These are token transfers where the from address differs from the wallet — potential drainer contract activity.
                </div>
              )}
              <DataTable
                headers={['Hash', 'From', 'To', 'Value', 'Date']}
                rows={result.drainTransactions.map((tx) => [
                  <div key={tx.hash} className="flex items-center gap-1">
                    <span className="truncate w-24">{tx.hash.slice(0, 10)}...</span>
                    <CopyButton value={tx.hash} />
                  </div>,
                  `${tx.from.slice(0, 10)}...`,
                  `${(tx.to ?? '').slice(0, 10)}...`,
                  tx.value,
                  new Date(tx.timestamp).toLocaleDateString(),
                ])}
              />
              {!result.drainTransactions.length && <EmptyState message="No drain candidates detected" />}
            </Panel>
          )}

          {activeSection === 'related' && (
            <Panel title="Related Addresses">
              <div className="space-y-1.5">
                {result.relatedAddresses.map((addr) => (
                  <div key={addr} className="flex items-center justify-between p-2 bg-grok-surface-2 rounded border border-grok-border">
                    <span className="text-xs font-mono text-grok-text-body">{addr}</span>
                    <CopyButton value={addr} />
                  </div>
                ))}
                {!result.relatedAddresses.length && <EmptyState message="No related addresses found" />}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// Tab 7: Numbered Domain Scan
// ============================================================================

function NumberedDomainTab() {
  const { addToast } = useUIStore();
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [fromNum, setFromNum] = useState('1');
  const [toNum, setToNum] = useState('20');
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<NumberedDomainResult | null>(null);
  const [pushState, setPushState] = useState<PushState>({ state: 'idle', createdIds: [] });
  const [filter, setFilter] = useState<'all' | 'registered' | 'active'>('all');

  const run = useCallback(async () => {
    const from = parseInt(fromNum, 10);
    const to = parseInt(toNum, 10);
    if (!prefix.trim() && !suffix.trim()) {
      setError('Enter a prefix and/or suffix');
      return;
    }
    if (isNaN(from) || isNaN(to) || from < 0 || to < from) {
      setError('Invalid range — from must be <= to');
      return;
    }
    if (to - from > 99) {
      setError('Maximum range is 100 domains per scan');
      return;
    }
    setLoadState('loading');
    setError('');
    setResult(null);
    try {
      const res = await fetchNumberedDomainScan(
        prefix.trim().toLowerCase(),
        suffix.trim().toLowerCase(),
        from,
        to
      );
      setResult(res);
      setLoadState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Numbered domain scan failed');
      setLoadState('error');
    }
  }, [prefix, suffix, fromNum, toNum]);

  const pushToOpenCTI = useCallback(async () => {
    if (!result) return;
    const toPublish = result.entries.filter((e) => e.registered);
    setPushState({ state: 'loading', createdIds: [] });
    const ids: string[] = [];
    let count = 0;
    try {
      for (const entry of toPublish) {
        try {
          const id = await pushDomainToOpenCTI(entry.domain);
          ids.push(id);
          count++;
          if (entry.ip) {
            const ipId = await pushIPToOpenCTI(entry.ip);
            ids.push(ipId);
            await linkObservables(id, ipId, 'resolves-to').catch(() => {});
          }
        } catch { /* skip */ }
      }
      setPushState({ state: 'success', createdIds: ids });
      addToast({ type: 'success', message: `Pushed ${count} registered domains to OpenCTI` });
    } catch (err) {
      setPushState({ state: 'error', createdIds: [] });
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'OpenCTI push failed' });
    }
  }, [result, addToast]);

  const registeredCount = result?.entries.filter((e) => e.registered).length ?? 0;
  const activeCount = result?.entries.filter((e) => e.active).length ?? 0;

  const filtered = result?.entries.filter((e) => {
    if (filter === 'registered') return e.registered;
    if (filter === 'active') return e.active;
    return true;
  }) ?? [];

  return (
    <div className="space-y-4">
      <Panel title="Numbered Domain Range Scan">
        <div className="space-y-3">
          <p className="text-xs text-grok-text-muted">
            Scan a range of numbered domains, e.g., prefix=<code className="font-mono bg-grok-surface-3 px-1 rounded">qsjt</code>{' '}
            suffix=<code className="font-mono bg-grok-surface-3 px-1 rounded">.com</code> range 1-100 scans qsjt1.com through qsjt100.com
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Prefix"
              placeholder="qsjt"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
            <Input
              label="Suffix (include dot)"
              placeholder=".com"
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="From"
              type="number"
              min="0"
              value={fromNum}
              onChange={(e) => setFromNum(e.target.value)}
            />
            <Input
              label="To (max 100 range)"
              type="number"
              min="1"
              value={toNum}
              onChange={(e) => setToNum(e.target.value)}
            />
          </div>
          <div className="text-xs text-grok-text-muted">
            Preview: <code className="font-mono bg-grok-surface-3 px-1 rounded">{prefix || '[prefix]'}{fromNum || '1'}{suffix || '[suffix]'}</code>
            {' '}...{' '}
            <code className="font-mono bg-grok-surface-3 px-1 rounded">{prefix || '[prefix]'}{toNum || '20'}{suffix || '[suffix]'}</code>
          </div>
          <button
            onClick={run}
            disabled={loadState === 'loading'}
            className="px-4 py-2 bg-grok-recon-blue text-white rounded-md text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loadState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scan className="w-4 h-4" />}
            Scan Range
          </button>
        </div>
        {loadState === 'loading' && <LoadingSpinner label="Resolving DNS for domain range... (may take ~30s for large ranges)" />}
        {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
      </Panel>

      {result && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-grok-text-heading">
                Scanned {result.entries.length} domains
              </h3>
              <div className="flex gap-2 text-xs">
                <span className="text-grok-loot-green">{registeredCount} registered</span>
                <span className="text-grok-scan-cyan">{activeCount} active</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-grok-text-muted">{new Date(result.timestamp).toLocaleTimeString()}</span>
              <PushButton label="Push Registered to OpenCTI" pushState={pushState} onClick={pushToOpenCTI} />
            </div>
          </div>

          <div className="flex gap-1">
            {(['all', 'registered', 'active'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-medium transition-colors capitalize',
                  filter === f
                    ? 'bg-grok-recon-blue text-white'
                    : 'text-grok-text-muted hover:text-grok-text-body hover:bg-grok-hover'
                )}
                aria-pressed={filter === f}
              >
                {f} ({
                  f === 'all' ? result.entries.length :
                  f === 'registered' ? registeredCount :
                  activeCount
                })
              </button>
            ))}
          </div>

          <Panel title="Domain Scan Results" noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-grok-border">
                    <th className="text-left py-2 px-3 text-grok-text-muted uppercase tracking-wide font-semibold">Domain</th>
                    <th className="text-left py-2 px-3 text-grok-text-muted uppercase tracking-wide font-semibold">Registered</th>
                    <th className="text-left py-2 px-3 text-grok-text-muted uppercase tracking-wide font-semibold">Active</th>
                    <th className="text-left py-2 px-3 text-grok-text-muted uppercase tracking-wide font-semibold">IP</th>
                    <th className="text-left py-2 px-3 text-grok-text-muted uppercase tracking-wide font-semibold">HTTP</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => (
                    <tr key={entry.domain} className="border-b border-grok-border hover:bg-grok-hover transition-colors">
                      <td className="py-2 px-3 font-mono text-grok-text-body">{entry.domain}</td>
                      <td className="py-2 px-3">
                        {entry.registered ? (
                          <CheckCircle2 className="w-4 h-4 text-grok-loot-green" />
                        ) : (
                          <XCircle className="w-4 h-4 text-grok-text-muted" />
                        )}
                      </td>
                      <td className="py-2 px-3">
                        {entry.active ? (
                          <CheckCircle2 className="w-4 h-4 text-grok-scan-cyan" />
                        ) : entry.registered ? (
                          <AlertTriangle className="w-4 h-4 text-grok-warning" />
                        ) : (
                          <span className="text-grok-text-muted">-</span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-mono text-grok-scan-cyan">{entry.ip ?? '-'}</td>
                      <td className="py-2 px-3 font-mono">
                        {entry.statusCode != null ? (
                          <span className={cn(
                            entry.statusCode < 300 ? 'text-grok-loot-green' :
                            entry.statusCode < 400 ? 'text-grok-warning' :
                            'text-grok-error'
                          )}>
                            {entry.statusCode}
                          </span>
                        ) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && <EmptyState message="No results match the current filter" />}
          </Panel>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Root Component
// ============================================================================

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'domain-recon', label: 'Domain Recon', icon: Globe },
  { id: 'infra-map', label: 'Infrastructure Map', icon: Map },
  { id: 'domain-cluster', label: 'Domain Cluster', icon: Network },
  { id: 'wayback', label: 'Wayback & Content', icon: Archive },
  { id: 'urlscan', label: 'urlscan.io', icon: Search },
  { id: 'blockchain', label: 'Blockchain', icon: Bitcoin },
  { id: 'numbered-domain', label: 'Numbered Domain', icon: Hash },
];

export function OsintInvestigationView() {
  const [activeTab, setActiveTab] = useState<TabId>('domain-recon');

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-shrink-0 px-4 pt-4 pb-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-grok-scan-cyan/10 rounded-lg">
            <Search className="w-5 h-5 text-grok-scan-cyan" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-grok-text-heading">OSINT Investigation</h2>
            <p className="text-xs text-grok-text-muted">
              Open-source intelligence workbench — domain recon, blockchain tracing, and infrastructure mapping
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {TABS.map((tab) => (
            <TabButton
              key={tab.id}
              id={tab.id}
              label={tab.label}
              icon={tab.icon}
              active={activeTab === tab.id}
              onClick={setActiveTab}
            />
          ))}
        </div>
        <div className="h-px bg-grok-border mt-1" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {activeTab === 'domain-recon' && <DomainReconTab />}
        {activeTab === 'infra-map' && <InfraMapTab />}
        {activeTab === 'domain-cluster' && <DomainClusterTab />}
        {activeTab === 'wayback' && <WaybackTab />}
        {activeTab === 'urlscan' && <UrlscanTab />}
        {activeTab === 'blockchain' && <BlockchainTab />}
        {activeTab === 'numbered-domain' && <NumberedDomainTab />}
      </div>
    </div>
  );
}
