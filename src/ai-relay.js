/**
 * AI Relay — dispatch tasks to Codex / Claude Code CLI
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CODEX_BIN = '/opt/homebrew/bin/codex';
const CODEX_HOME = join(homedir(), '.codex-api'); // API profile for non-interactive dispatch

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
  const { cwd, model, allowedTools, timeout = 300000 } = options;
  const claudeBin = findClaudeBin();

  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'text'];
    if (model) args.push('--model', model);
    if (allowedTools) args.push('--allowedTools', allowedTools);
    args.push(prompt);

    execFile(claudeBin, args, {
      cwd: cwd || process.cwd(),
      timeout,
      maxBuffer: 1024 * 1024 * 10,
      env: { ...process.env }
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Claude failed: ${err.message}\nstderr: ${stderr}`));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}
