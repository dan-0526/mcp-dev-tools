/**
 * 图片识别 — macOS Vision OCR 兜底 + 可选 API provider
 *
 * 环境变量:
 *   VISION_PROVIDER  — "claude" | "openai" | 留空用 macOS 本地 OCR
 *   ANTHROPIC_API_KEY — Claude API key (provider=claude 时需要)
 *   OPENAI_API_KEY    — OpenAI API key (provider=openai 时需要)
 *   VISION_MODEL      — 可选，覆盖默认模型
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFetchOptions } from './proxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OCR_SCRIPT = resolve(__dirname, 'ocr-mac.swift');

const PROVIDER = (process.env.VISION_PROVIDER || '').toLowerCase();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

// ─── macOS Vision OCR (本地，免费) ───

function ocrLocal(imagePath, lang = 'zh-Hans,en') {
  return new Promise((resolve, reject) => {
    execFile('swift', [OCR_SCRIPT, imagePath, lang], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('OCR 输出解析失败'));
      }
    });
  });
}

// ─── Claude Vision API ───

async function ocrClaude(imagePath, prompt) {
  if (!ANTHROPIC_KEY) throw new Error('未配置 ANTHROPIC_API_KEY');

  const imageData = await readFile(imagePath);
  const base64 = imageData.toString('base64');
  const ext = imagePath.split('.').pop().toLowerCase();
  const mediaType = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] || 'image/jpeg';
  const model = process.env.VISION_MODEL || 'claude-sonnet-4-20250514';

  const url = 'https://api.anthropic.com/v1/messages';
  const body = {
    model,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: prompt || '请识别这张图片中的所有文字内容，保持原始排版格式。' }
      ]
    }]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body),
    ...getFetchOptions(url)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text}`);
  }

  const data = await res.json();
  const text = data.content?.map(c => c.text).join('\n') || '';
  return { text, provider: 'claude', model };
}

// ─── OpenAI Vision API ───

async function ocrOpenAI(imagePath, prompt) {
  if (!OPENAI_KEY) throw new Error('未配置 OPENAI_API_KEY');

  const imageData = await readFile(imagePath);
  const base64 = imageData.toString('base64');
  const ext = imagePath.split('.').pop().toLowerCase();
  const mediaType = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] || 'image/jpeg';
  const model = process.env.VISION_MODEL || 'gpt-4o';

  const url = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
        { type: 'text', text: prompt || '请识别这张图片中的所有文字内容，保持原始排版格式。' }
      ]
    }]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify(body),
    ...getFetchOptions(url)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${text}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return { text, provider: 'openai', model };
}

// ─── 统一入口 ───

export async function recognizeImage(imagePath, { prompt, lang } = {}) {
  const absPath = resolve(imagePath);

  if (PROVIDER === 'claude') {
    return ocrClaude(absPath, prompt);
  }
  if (PROVIDER === 'openai') {
    return ocrOpenAI(absPath, prompt);
  }

  // 默认: macOS 本地 OCR
  const result = await ocrLocal(absPath, lang);
  return { text: result.text, blocks: result.blocks, provider: 'macos-vision' };
}
