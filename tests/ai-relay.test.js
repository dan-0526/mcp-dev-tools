import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import assert from 'node:assert/strict';

import { claudeExec } from '../src/ai-relay.js';
import { createClaudeRelayServer } from '../src/claude-relay-server.js';

test('claudeExec closes stdin for non-interactive Claude runs', async () => {
  const originalNvmDir = process.env.NVM_DIR;
  const root = await mkdtemp(join(tmpdir(), 'mcp-dev-tools-claude-'));
  const binDir = join(root, 'versions', 'node', process.version, 'bin');
  const claudeBin = join(binDir, 'claude');

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(
      claudeBin,
      [
        '#!/usr/bin/env node',
        "process.stdin.resume();",
        "process.stdin.on('end', () => {",
        "  console.log('FAKE_CLAUDE_STDIN_CLOSED');",
        '});',
        ''
      ].join('\n')
    );
    await chmod(claudeBin, 0o755);
    process.env.NVM_DIR = root;

    const result = await claudeExec('ignored prompt', { timeout: 1000 });

    assert.equal(result.stdout, 'FAKE_CLAUDE_STDIN_CLOSED');
    assert.equal(result.stderr, '');
  } finally {
    if (originalNvmDir === undefined) {
      delete process.env.NVM_DIR;
    } else {
      process.env.NVM_DIR = originalNvmDir;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('claudeExec strips proxy environment variables by default', async () => {
  const originalNvmDir = process.env.NVM_DIR;
  const originalProxyEnv = {
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    http_proxy: process.env.http_proxy,
    https_proxy: process.env.https_proxy
  };
  const root = await mkdtemp(join(tmpdir(), 'mcp-dev-tools-claude-env-'));
  const binDir = join(root, 'versions', 'node', process.version, 'bin');
  const claudeBin = join(binDir, 'claude');

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(
      claudeBin,
      [
        '#!/usr/bin/env node',
        'console.log(JSON.stringify({',
        '  HTTP_PROXY: process.env.HTTP_PROXY || null,',
        '  HTTPS_PROXY: process.env.HTTPS_PROXY || null,',
        '  http_proxy: process.env.http_proxy || null,',
        '  https_proxy: process.env.https_proxy || null',
        '}));',
        ''
      ].join('\n')
    );
    await chmod(claudeBin, 0o755);
    process.env.NVM_DIR = root;
    process.env.HTTP_PROXY = 'http://127.0.0.1:7890';
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
    process.env.http_proxy = 'http://127.0.0.1:7890';
    process.env.https_proxy = 'http://127.0.0.1:7890';

    const result = await claudeExec('ignored prompt', { timeout: 1000 });

    assert.deepEqual(JSON.parse(result.stdout), {
      HTTP_PROXY: null,
      HTTPS_PROXY: null,
      http_proxy: null,
      https_proxy: null
    });
  } finally {
    if (originalNvmDir === undefined) {
      delete process.env.NVM_DIR;
    } else {
      process.env.NVM_DIR = originalNvmDir;
    }
    for (const [name, value] of Object.entries(originalProxyEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('claudeExec can preserve proxy environment variables when requested', async () => {
  const originalNvmDir = process.env.NVM_DIR;
  const originalHttpsProxy = process.env.HTTPS_PROXY;
  const root = await mkdtemp(join(tmpdir(), 'mcp-dev-tools-claude-env-'));
  const binDir = join(root, 'versions', 'node', process.version, 'bin');
  const claudeBin = join(binDir, 'claude');

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(
      claudeBin,
      [
        '#!/usr/bin/env node',
        'console.log(process.env.HTTPS_PROXY || "missing");',
        ''
      ].join('\n')
    );
    await chmod(claudeBin, 0o755);
    process.env.NVM_DIR = root;
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';

    const result = await claudeExec('ignored prompt', {
      timeout: 1000,
      preserveProxyEnv: true
    });

    assert.equal(result.stdout, 'http://127.0.0.1:7890');
  } finally {
    if (originalNvmDir === undefined) {
      delete process.env.NVM_DIR;
    } else {
      process.env.NVM_DIR = originalNvmDir;
    }
    if (originalHttpsProxy === undefined) {
      delete process.env.HTTPS_PROXY;
    } else {
      process.env.HTTPS_PROXY = originalHttpsProxy;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('claudeExec can route requests through an HTTP relay', async () => {
  const originalFetch = globalThis.fetch;
  let receivedBody;
  let receivedUrl;

  try {
    globalThis.fetch = async (url, options) => {
      globalThis.fetch.lastOptions = options;
      receivedUrl = String(url);
      receivedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ stdout: 'RELAY_STDOUT', stderr: 'RELAY_STDERR' })
      };
    };

    const result = await claudeExec('relay prompt', {
      mode: 'relay',
      relayUrl: 'http://relay.local:4567',
      relayToken: 'relay-secret',
      cwd: '/tmp/relay-cwd',
      model: 'opus',
      allowedTools: 'Bash',
      timeout: 4321
    });

    assert.equal(receivedUrl, 'http://relay.local:4567/claude');
    assert.equal(globalThis.fetch.lastOptions.headers.authorization, 'Bearer relay-secret');
    assert.deepEqual(receivedBody, {
      prompt: 'relay prompt',
      cwd: '/tmp/relay-cwd',
      model: 'opus',
      allowedTools: 'Bash',
      timeout: 4321
    });
    assert.equal(result.stdout, 'RELAY_STDOUT');
    assert.equal(result.stderr, 'RELAY_STDERR');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createClaudeRelayServer forwards Claude requests to its executor', async () => {
  const calls = [];
  const server = createClaudeRelayServer({
    token: 'server-secret',
    execute: async (prompt, options) => {
      calls.push({ prompt, options });
      return { stdout: 'SERVER_STDOUT', stderr: '' };
    }
  });
  const handler = server.listeners('request')[0];
  const req = Readable.from([
    Buffer.from(JSON.stringify({
      prompt: 'server prompt',
      cwd: '/tmp/server-cwd',
      model: 'sonnet',
      allowedTools: 'Read',
      timeout: 1234
    }))
  ]);
  req.method = 'POST';
  req.url = '/claude';
  req.headers = { authorization: 'Bearer server-secret' };
  const res = {
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };

  try {
    await handler(req, res);
    const body = JSON.parse(res.body);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(body, { stdout: 'SERVER_STDOUT', stderr: '' });
    assert.deepEqual(calls, [
      {
        prompt: 'server prompt',
        options: {
          mode: 'direct',
          cwd: '/tmp/server-cwd',
          model: 'sonnet',
          allowedTools: 'Read',
          timeout: 1234,
          preserveProxyEnv: undefined
        }
      }
    ]);
  } finally {
    server.close();
  }
});

test('createClaudeRelayServer rejects requests with a wrong token', async () => {
  const server = createClaudeRelayServer({
    token: 'server-secret',
    execute: async () => {
      throw new Error('should not run');
    }
  });
  const handler = server.listeners('request')[0];
  const req = Readable.from([Buffer.from(JSON.stringify({ prompt: 'blocked' }))]);
  req.method = 'POST';
  req.url = '/claude';
  req.headers = { authorization: 'Bearer wrong-secret' };
  const res = {
    statusCode: undefined,
    body: undefined,
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(body) {
      this.body = body;
    }
  };

  try {
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(JSON.parse(res.body), { error: 'Unauthorized' });
  } finally {
    server.close();
  }
});
