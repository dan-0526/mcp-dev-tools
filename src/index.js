#!/usr/bin/env node

/**
 * MCP Dev Tools
 * 通过 MCP 协议聚合 GitHub / GitLab / Figma 等开发工具
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

const server = new McpServer({
  name: 'mcp-dev-tools',
  version: '0.2.0'
});

registerTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🚀 mcp-dev-tools running (stdio)');
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
