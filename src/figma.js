/**
 * Figma API 封装
 */

const FIGMA_TOKEN = process.env.FIGMA_TOKEN || '';
const FIGMA_API = 'https://api.figma.com';

async function request(pathname, params = {}) {
  if (!FIGMA_TOKEN) throw new Error('未配置 FIGMA_TOKEN 环境变量');

  const url = new URL(`${FIGMA_API}${pathname}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    headers: { 'X-Figma-Token': FIGMA_TOKEN }
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Figma API 返回非 JSON，HTTP ${res.status}`);
  }

  if (!res.ok || json?.err) {
    throw new Error(
      `Figma API ${res.status}: ${json?.message || json?.err || text}`
    );
  }
  return json;
}

// ─── URL 解析 ───

function normalizeNodeId(nodeId = '') {
  const decoded = decodeURIComponent(nodeId || '');
  if (!decoded) return '';
  if (decoded.includes(':')) return decoded;
  if (decoded.includes('-')) return decoded.replace(/-/g, ':');
  return decoded;
}

export function parseFigmaUrl(figmaUrl) {
  const url = new URL(figmaUrl);
  const parts = url.pathname.split('/').filter(Boolean);
  const designIdx = parts.indexOf('design');
  const fileIdx = parts.indexOf('file');

  let fileKey = '';
  if (designIdx >= 0 && parts[designIdx + 1]) fileKey = parts[designIdx + 1];
  if (!fileKey && fileIdx >= 0 && parts[fileIdx + 1])
    fileKey = parts[fileIdx + 1];

  const rawNodeId =
    url.searchParams.get('node-id') || url.searchParams.get('node_id') || '';
  const nodeId = normalizeNodeId(rawNodeId);

  if (!fileKey) throw new Error('无法从 Figma URL 中解析 fileKey');
  return { fileKey, nodeId };
}

// ─── API 调用 ───

async function getFile(fileKey) {
  return request(`/v1/files/${fileKey}`);
}

async function getNodes(fileKey, nodeIds) {
  return request(`/v1/files/${fileKey}/nodes`, { ids: nodeIds.join(',') });
}

async function getImages(fileKey, nodeIds, scale = 2, format = 'png') {
  return request(`/v1/images/${fileKey}`, {
    ids: nodeIds.join(','),
    scale,
    format,
    use_absolute_bounds: true
  });
}

// ─── 节点遍历工具 ───

function walkNodes(root, visit, depth = 0) {
  if (!root || typeof root !== 'object') return;
  visit(root, depth);
  if (Array.isArray(root.children)) {
    for (const child of root.children) walkNodes(child, visit, depth + 1);
  }
}

function solidFillToHex(node) {
  const paints = node.fills;
  if (!Array.isArray(paints)) return '';
  const solid = paints.find((p) => p?.type === 'SOLID' && p.visible !== false);
  if (!solid?.color) return '';
  const { r, g, b } = solid.color;
  return (
    '#' +
    [r, g, b]
      .map((v) =>
        Math.round(Math.min(Math.max(v, 0), 1) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
      .toUpperCase()
  );
}

function rgb01ToHex(c) {
  if (!c) return '';
  const r = Math.round(Math.min(Math.max(c.r ?? 0, 0), 1) * 255);
  const g = Math.round(Math.min(Math.max(c.g ?? 0, 0), 1) * 255);
  const b = Math.round(Math.min(Math.max(c.b ?? 0, 0), 1) * 255);
  return (
    '#' +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

// ─── 获取根节点 ───

async function fetchRoot(fileKey, nodeId) {
  if (nodeId) {
    const data = await getNodes(fileKey, [nodeId]);
    const root = data?.nodes?.[nodeId]?.document;
    if (!root) throw new Error('未获取到指定节点数据');
    return root;
  }
  const data = await getFile(fileKey);
  const root = data?.document;
  if (!root) throw new Error('未获取到设计稿数据');
  return root;
}

// ─── CSS 提取工具 ───

function fillToCSS(fills) {
  if (!Array.isArray(fills) || !fills.length) return {};
  const visible = fills.filter((f) => f.visible !== false);
  if (!visible.length) return {};

  const css = {};
  for (const fill of visible) {
    if (fill.type === 'SOLID' && fill.color) {
      const hex = rgb01ToHex(fill.color);
      const a = fill.opacity ?? fill.color.a ?? 1;
      css.background =
        a < 1
          ? `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`
          : hex;
    } else if (fill.type === 'GRADIENT_LINEAR' && fill.gradientStops) {
      const stops = fill.gradientStops
        .map((s) => `${rgb01ToHex(s.color)} ${Math.round(s.position * 100)}%`)
        .join(', ');
      css.background = `linear-gradient(${stops})`;
    } else if (fill.type === 'IMAGE') {
      css.background = 'url(IMAGE)';
    }
  }
  return css;
}

function effectsToCSS(effects) {
  if (!Array.isArray(effects) || !effects.length) return {};
  const css = {};
  const shadows = [];
  for (const e of effects) {
    if (e.visible === false) continue;
    if ((e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && e.color) {
      const { r, g, b, a = 1 } = e.color;
      const color =
        a < 1
          ? `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a.toFixed(2)})`
          : rgb01ToHex(e.color);
      const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
      shadows.push(
        `${inset}${e.offset?.x || 0}px ${e.offset?.y || 0}px ${e.radius || 0}px ${e.spread || 0}px ${color}`
      );
    } else if (e.type === 'LAYER_BLUR' && e.radius) {
      css.filter = `blur(${e.radius}px)`;
    } else if (e.type === 'BACKGROUND_BLUR' && e.radius) {
      css['backdrop-filter'] = `blur(${e.radius}px)`;
    }
  }
  if (shadows.length) css['box-shadow'] = shadows.join(', ');
  return css;
}

function nodeToCSS(node) {
  const css = {};
  const box = node.absoluteBoundingBox || {};

  if (box.width) css.width = `${Math.round(box.width)}px`;
  if (box.height) css.height = `${Math.round(box.height)}px`;

  if (node.opacity !== undefined && node.opacity < 1) {
    css.opacity = node.opacity.toFixed(2);
  }

  if (node.cornerRadius) {
    css['border-radius'] = `${node.cornerRadius}px`;
  } else if (node.rectangleCornerRadii) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    css['border-radius'] = `${tl}px ${tr}px ${br}px ${bl}px`;
  }

  Object.assign(css, fillToCSS(node.fills));

  if (node.strokes?.length && node.strokeWeight) {
    const strokeFill = fillToCSS(node.strokes);
    const color = strokeFill.background || '#000';
    css.border = `${node.strokeWeight}px solid ${color}`;
  }

  Object.assign(css, effectsToCSS(node.effects));

  if (node.layoutMode) {
    css.display = 'flex';
    css['flex-direction'] =
      node.layoutMode === 'VERTICAL' ? 'column' : 'row';
    if (node.itemSpacing) css.gap = `${node.itemSpacing}px`;
    const justifyMap = {
      MIN: 'flex-start',
      CENTER: 'center',
      MAX: 'flex-end',
      SPACE_BETWEEN: 'space-between'
    };
    const alignMap = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end' };
    if (node.primaryAxisAlignItems)
      css['justify-content'] =
        justifyMap[node.primaryAxisAlignItems] || node.primaryAxisAlignItems;
    if (node.counterAxisAlignItems)
      css['align-items'] =
        alignMap[node.counterAxisAlignItems] || node.counterAxisAlignItems;
  }

  const { paddingLeft: pl, paddingRight: pr, paddingTop: pt, paddingBottom: pb } = node;
  if (pl || pr || pt || pb) {
    css.padding = `${pt || 0}px ${pr || 0}px ${pb || 0}px ${pl || 0}px`;
  }

  if (node.type === 'TEXT') {
    const s = node.style || {};
    if (s.fontFamily) css['font-family'] = s.fontFamily;
    if (s.fontSize) css['font-size'] = `${s.fontSize}px`;
    if (s.fontWeight) css['font-weight'] = String(s.fontWeight);
    if (s.lineHeightPx)
      css['line-height'] = `${Math.round(s.lineHeightPx)}px`;
    if (s.letterSpacing) css['letter-spacing'] = `${s.letterSpacing}px`;
    if (s.textAlignHorizontal)
      css['text-align'] = s.textAlignHorizontal.toLowerCase();
    const textFill = fillToCSS(node.fills);
    if (textFill.background) {
      css.color = textFill.background;
      delete css.background;
    }
  }

  return css;
}

// ─── 6. css: 提取节点 CSS 样式 ───

export async function css(figmaUrl, nodeIds) {
  const { fileKey } = parseFigmaUrl(figmaUrl);
  const ids = nodeIds.map((s) => normalizeNodeId(s.trim())).filter(Boolean);
  if (!ids.length) throw new Error('缺少 nodeIds');

  const data = await getNodes(fileKey, ids);
  const results = [];

  for (const id of ids) {
    const node = data?.nodes?.[id]?.document;
    if (!node) {
      results.push({ id, name: '', type: '', css: {}, error: 'node not found' });
      continue;
    }
    const styles = nodeToCSS(node);
    const children = [];
    if (node.children) {
      for (const child of node.children) {
        children.push({
          id: child.id,
          name: child.name,
          type: child.type,
          css: nodeToCSS(child)
        });
      }
    }
    results.push({
      id: node.id,
      name: node.name,
      type: node.type,
      css: styles,
      children
    });
  }

  return { fileKey, count: results.length, nodes: results };
}

// ─── 1. inspect: 按前缀查找节点 ───

export async function inspect(figmaUrl, prefix = 'D2C-') {
  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  const root = await fetchRoot(fileKey, nodeId);

  const matched = [];
  walkNodes(root, (node) => {
    const name = node?.name || '';
    if (typeof name === 'string' && name.startsWith(prefix)) {
      const box = node.absoluteBoundingBox || {};
      matched.push({
        id: node.id,
        name,
        imageName: name.slice(prefix.length),
        width: Math.round(box.width || 0),
        height: Math.round(box.height || 0)
      });
    }
  });

  return { fileKey, nodeId, prefix, count: matched.length, nodes: matched };
}

// ─── 2. tree: 浏览节点树 ───

export async function tree(
  figmaUrl,
  {
    keywords = '',
    types = '',
    maxWidth = 0,
    maxHeight = 0,
    depth = 99,
    showColor = false
  } = {}
) {
  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  const root = await fetchRoot(fileKey, nodeId);

  const keywordList = keywords
    ? keywords
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const typeList = types
    ? types
        .split(',')
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
    : [];

  const lines = [];

  function shouldShow(node) {
    if (!keywordList.length && !typeList.length && !maxWidth && !maxHeight)
      return true;
    const name = (node.name || '').toLowerCase();
    const type = node.type || '';
    const box = node.absoluteBoundingBox || {};
    const w = box.width || 0;
    const h = box.height || 0;

    let match = true;
    if (keywordList.length)
      match = match && keywordList.some((k) => name.includes(k));
    if (typeList.length) match = match && typeList.includes(type);
    if (maxWidth > 0) match = match && w > 0 && w <= maxWidth;
    if (maxHeight > 0) match = match && h > 0 && h <= maxHeight;
    return match;
  }

  walkNodes(root, (node, d) => {
    if (d > depth) return;
    if (!shouldShow(node)) return;
    const box = node.absoluteBoundingBox || {};
    const w = Math.round(box.width || 0);
    const h = Math.round(box.height || 0);
    const fills = (node.fills || []).map((f) => f.type).join(',');
    const indent = '  '.repeat(d);
    const chars =
      node.type === 'TEXT' && node.characters
        ? ` text:"${node.characters.slice(0, 50)}"`
        : '';
    const color = showColor
      ? (() => {
          const hex = solidFillToHex(node);
          return hex ? ` color:${hex}` : '';
        })()
      : '';
    lines.push(
      `${indent}${node.type} | "${node.name}" | ${w}x${h} | fills:${fills}${color}${chars} | id:${node.id}`
    );
  });

  return { fileKey, nodeCount: lines.length, tree: lines.join('\n') };
}

// ─── 3. images: 获取导出图片 URL ───

export async function images(figmaUrl, nodeIds, scale = 2, format = 'png') {
  const { fileKey } = parseFigmaUrl(figmaUrl);
  const ids = nodeIds.map((s) => normalizeNodeId(s.trim())).filter(Boolean);
  if (!ids.length) throw new Error('缺少 nodeIds');
  const data = await getImages(fileKey, ids, scale, format);
  return { fileKey, format, scale, images: data?.images || {} };
}

// ─── 4. export: 获取图片 URL + 下载信息 ───

export async function exportImages(
  figmaUrl,
  mapping,
  scale = 2,
  format = 'png'
) {
  const { fileKey } = parseFigmaUrl(figmaUrl);

  // mapping: { "nodeId": "outputPath", ... }
  const nodeIds = Object.keys(mapping)
    .map((k) => normalizeNodeId(k))
    .filter(Boolean);
  if (!nodeIds.length) throw new Error('mapping 为空');

  const data = await getImages(fileKey, nodeIds, scale, format);
  const imageMap = data?.images || {};

  const results = [];
  for (const [rawId, outPath] of Object.entries(mapping)) {
    const nodeId = normalizeNodeId(rawId);
    const url = imageMap[nodeId];
    results.push({
      nodeId,
      outPath,
      url: url || null,
      status: url ? 'ok' : 'no_url'
    });
  }

  return { fileKey, format, scale, results };
}

// ─── 5. text: 提取文字、颜色、高亮 ───

function extractTextWithHighlights(node) {
  const text = node.characters || '';
  const baseFill = node.fills?.[0]?.color
    ? rgb01ToHex(node.fills[0].color)
    : '';
  const overrides = node.characterStyleOverrides || [];
  const styleMap = node.styleOverrideTable || {};

  if (!overrides.length || !Object.keys(styleMap).length) {
    return { text, baseColor: baseFill, html: text, highlights: [] };
  }

  const segments = [];
  let segStart = 0;
  let segStyle = overrides[0] || 0;
  for (let i = 1; i <= text.length; i++) {
    const curStyle = i < overrides.length ? overrides[i] || 0 : -1;
    if (curStyle !== segStyle) {
      segments.push({ start: segStart, end: i, styleId: segStyle });
      segStart = i;
      segStyle = curStyle;
    }
  }

  const highlights = [];
  let html = '';
  for (const seg of segments) {
    const chunk = text.slice(seg.start, seg.end);
    if (seg.styleId && styleMap[seg.styleId]) {
      const override = styleMap[seg.styleId];
      const color = override.fills?.[0]?.color
        ? rgb01ToHex(override.fills[0].color)
        : '';
      if (color && color !== baseFill) {
        html += `<span style="color: ${color};">${chunk}</span>`;
        highlights.push({ text: chunk, color, start: seg.start, end: seg.end });
        continue;
      }
    }
    html += chunk;
  }

  return { text, baseColor: baseFill, html, highlights };
}

export async function extractText(
  figmaUrl,
  { keywords = '', depth = 99 } = {}
) {
  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  const root = await fetchRoot(fileKey, nodeId);

  const keywordList = keywords
    ? keywords
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)
    : [];

  const results = [];

  walkNodes(root, (node, d) => {
    if (d > depth) return;
    if (node.type !== 'TEXT' || !node.characters) return;

    const name = (node.name || '').toLowerCase();
    const chars = (node.characters || '').toLowerCase();
    const match =
      !keywordList.length ||
      keywordList.some((k) => name.includes(k) || chars.includes(k));
    if (!match) return;

    const info = extractTextWithHighlights(node);
    const box = node.absoluteBoundingBox || {};
    results.push({
      id: node.id,
      name: node.name,
      text: info.text,
      baseColor: info.baseColor,
      html: info.html,
      highlights: info.highlights,
      width: Math.round(box.width || 0),
      height: Math.round(box.height || 0)
    });
  });

  return { fileKey, count: results.length, texts: results };
}
