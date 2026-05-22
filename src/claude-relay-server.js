#!/usr/bin/env node

/**
 * Claude relay server.
 *
 * Run this outside Codex's sandbox when MCP tools cannot reach the local proxy.
 */

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { claudeExec } from './ai-relay.js';

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {};
  return JSON.parse(raw);
}

export function createClaudeRelayServer({
  execute = claudeExec,
  token = process.env.CLAUDE_RELAY_TOKEN
} = {}) {
  return http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/claude') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    if (token && req.headers?.authorization !== `Bearer ${token}`) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    try {
      const body = await readJson(req);
      if (!body.prompt || typeof body.prompt !== 'string') {
        sendJson(res, 400, { error: 'prompt is required' });
        return;
      }

      const result = await execute(body.prompt, {
        mode: 'direct',
        cwd: body.cwd,
        model: body.model,
        allowedTools: body.allowedTools,
        timeout: body.timeout,
        preserveProxyEnv: body.preserveProxyEnv
      });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });
}

export function startClaudeRelayServer({
  host = process.env.CLAUDE_RELAY_HOST || '127.0.0.1',
  port = Number(process.env.CLAUDE_RELAY_PORT || 38765)
} = {}) {
  const server = createClaudeRelayServer();
  server.listen(port, host, () => {
    console.error(`Claude relay listening on http://${host}:${port}`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startClaudeRelayServer();
}
