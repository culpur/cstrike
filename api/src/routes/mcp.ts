/**
 * MCP (Model Context Protocol) routes — tool definitions and execution.
 * GET  /api/v1/mcp/tools
 * POST /api/v1/mcp/tools/:toolName
 */

import { Router } from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { getConfigValue } from '../middleware/guardrails.js';

export const mcpRouter = Router();

// Get available MCP tools
mcpRouter.get('/tools', async (_req, res, next) => {
  try {
    const mcpEnabled = await getConfigValue('mcp_enabled', true);

    if (!mcpEnabled) {
      res.json({
        success: true,
        data: { enabled: false, tools: [] },
        timestamp: Date.now(),
      });
      return;
    }

    // MCP tools are dynamically loaded from the Python MCP server
    // This endpoint returns the tool definitions for the AI to use
    const tools = getMCPToolDefinitions();

    res.json({
      success: true,
      data: { enabled: true, tools, count: tools.length },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Execute an MCP tool
mcpRouter.post('/tools/:toolName', async (req, res, next) => {
  try {
    const { toolName } = req.params;
    const args = req.body;

    const mcpEnabled = await getConfigValue('mcp_enabled', true);
    if (!mcpEnabled) {
      throw new AppError(403, 'MCP tools are disabled');
    }

    // Execute tool via MCP bridge (Python subprocess)
    // For now, return a placeholder — full implementation in mcpBridge service
    res.json({
      success: true,
      data: {
        tool: toolName,
        args,
        status: 'executed',
        result: `MCP tool ${toolName} execution pending bridge implementation`,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Static MCP tool definitions — matches the Python MCP server's tool list.
 */
function getMCPToolDefinitions() {
  return [
    { name: 'nmap_scan', description: 'Run nmap scan against target', category: 'recon' },
    { name: 'subfinder_scan', description: 'Discover subdomains', category: 'recon' },
    { name: 'httpx_probe', description: 'HTTP endpoint probing', category: 'recon' },
    { name: 'nuclei_scan', description: 'Vulnerability scanning with nuclei', category: 'vuln' },
    { name: 'ffuf_fuzz', description: 'Web fuzzing with ffuf', category: 'web' },
    { name: 'sqlmap_scan', description: 'SQL injection testing', category: 'exploit' },
    { name: 'hydra_bruteforce', description: 'Credential bruteforcing', category: 'exploit' },
    { name: 'metasploit_exploit', description: 'Run Metasploit exploit', category: 'exploit' },
    { name: 'zap_scan', description: 'OWASP ZAP web scan', category: 'web' },
    { name: 'nikto_scan', description: 'Web server scanner', category: 'web' },
    { name: 'gobuster_scan', description: 'Directory/file brute-forcing', category: 'web' },
    { name: 'sslscan_check', description: 'SSL/TLS configuration audit', category: 'ssl' },
    { name: 'whatweb_detect', description: 'Web technology detection', category: 'recon' },
    { name: 'amass_enum', description: 'DNS enumeration', category: 'recon' },
    { name: 'credential_validate', description: 'Validate discovered credentials', category: 'cred' },
    { name: 'loot_search', description: 'Search collected loot', category: 'loot' },
    { name: 'report_generate', description: 'Generate scan report', category: 'report' },
  ];
}
