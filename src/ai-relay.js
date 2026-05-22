/**
 * AI Relay — dispatch tasks to Codex / Claude Code CLI
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CODEX_BIN = '/opt/homebrew/bin/codex';
const CODEX_HOME = join(homedir(), '.codex-api'); // API profile for non-interactive dispatch
const DEFAULT_CLAUDE_RELAY_URL = 'http://127.0.0.1:38765';

// Read API key from codex-api auth.json for injection into env
async function loadCodexApiKey() {
  try {
    const authPath = join(CODEX_HOME, 'auth.json');
    const auth = JSON.parse(await readFile(authPath, 'utf-8'));
    return auth.OPENAI_API_KEY || '';
  } catch {
    return '';
  }
}

// Claude binary is under nvm — resolve dynamically
function findClaudeBin() {
  const nvmDir = process.env.NVM_DIR || join(homedir(), '.nvm');
  // Try current node version first, then fallback
  const nodeVersion = process.version; // e.g. v22.16.0
  return join(nvmDir, 'versions/node', nodeVersion, 'bin/claude');
}

function createClaudeEnv({ preserveProxyEnv = false } = {}) {
  const env = { ...process.env };
  if (!preserveProxyEnv) {
    delete env.HTTP_PROXY;
    delete env.HTTPS_PROXY;
    delete env.http_proxy;
    delete env.https_proxy;
  }
  return env;
}

/**
 * Run Codex exec in non-interactive mode
 */
export async function codexExec(prompt, options = {}) {
  const { cwd, model, ephemeral = true, timeout = 300000 } = options;
  const apiKey = await loadCodexApiKey();

  return new Promise((resolve, reject) => {
    const args = ['exec'];
    if (model) args.push('-m', model);
    if (ephemeral) args.push('--ephemeral');
    args.push('--full-auto');
    args.push('--skip-git-repo-check');
    args.push(prompt);

    const proc = execFile(CODEX_BIN, args, {
      cwd: cwd || process.cwd(),
      timeout,
      maxBuffer: 1024 * 1024 * 10, // 10MB
      env: { ...process.env, CODEX_HOME, AICODING_API_KEY: apiKey }
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Codex failed: ${err.message}\nstderr: ${stderr}`));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/**
 * Run Claude Code in print mode (non-interactive)
 */
export function claudeExec(prompt, options = {}) {
  const { mode = process.env.CLAUDE_EXEC_MODE || 'direct' } = options;
  if (mode === 'relay') {
    return claudeRelayExec(prompt, options);
  }
  if (mode !== 'direct') {
    throw new Error(`Unsupported Claude execution mode: ${mode}`);
  }

  const {
    cwd,
    model,
    allowedTools,
    timeout = 300000,
    preserveProxyEnv = false
  } = options;
  const claudeBin = findClaudeBin();

  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'text'];
    if (model) args.push('--model', model);
    if (allowedTools) args.push('--allowedTools', allowedTools);
    args.push(prompt);

    const proc = execFile(claudeBin, args, {
      cwd: cwd || process.cwd(),
      timeout,
      maxBuffer: 1024 * 1024 * 10,
      env: createClaudeEnv({ preserveProxyEnv })
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Claude failed: ${err.message}\nstderr: ${stderr}`));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
    proc.stdin?.end();
  });
}

/**
 * Forward a Claude task to an out-of-sandbox relay process.
 */
export async function claudeRelayExec(prompt, options = {}) {
  const {
    cwd,
    model,
    allowedTools,
    timeout = 300000,
    preserveProxyEnv,
    relayUrl = process.env.CLAUDE_RELAY_URL || DEFAULT_CLAUDE_RELAY_URL,
    relayToken = process.env.CLAUDE_RELAY_TOKEN
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const url = new URL('/claude', relayUrl.endsWith('/') ? relayUrl : `${relayUrl}/`);
  const headers = { 'content-type': 'application/json' };
  if (relayToken) {
    headers.authorization = `Bearer ${relayToken}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        cwd,
        model,
        allowedTools,
        timeout,
        preserveProxyEnv
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Claude relay returned non-JSON response: ${text}`);
    }

    if (!response.ok) {
      throw new Error(
        `Claude relay failed (${response.status}): ${body.error || text}`
      );
    }

    return {
      stdout: String(body.stdout || '').trim(),
      stderr: String(body.stderr || '').trim()
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Claude relay timed out after ${timeout}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
