/**
 * MCP 工具注册
 */

import { z } from 'zod';
import * as github from './github.js';
import * as gitlab from './gitlab.js';
import * as figma from './figma.js';
import * as vision from './vision.js';

export function registerTools(server) {
  // --- GitHub ---

  server.tool(
    'github_get_file',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository name'),
      path: z.string().describe('File path, e.g. src/index.js'),
      ref: z
        .string()
        .optional()
        .describe('Branch or commit SHA, defaults to main branch')
    },
    async ({ owner, repo, path, ref }) => {
      try {
        const result = await github.getFile(owner, repo, path, ref);
        return {
          content: [
            {
              type: 'text',
              text: `📄 ${result.path} (${result.size} bytes)\n\n${result.content}`
            }
          ]
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Error: ${err.message}` }]
        };
      }
    }
  );

  server.tool(
    'github_search_code',
    {
      searchKey: z.string().describe('Repository searchKey'),
      repo: z.string().optional().describe('Limit to repo, e.g. facebook/react')
    },
    async ({ searchKey, repo }) => {
      try {
        const result = await github.searchCode(searchKey, repo);
        const list = result.content
          .map((f) => `📄 ${f.repo} → ${f.path}`)
          .join('\n');
        return { content: [{ type: 'text', text: list || '没有找到结果' }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Error: ${err.message}` }]
        };
      }
    }
  );

  server.tool(
    'github_list_files',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository name'),
      path: z.string().optional().describe('Directory path, empty for root'),
      ref: z.string().optional().describe('Branch or commit SHA')
    },
    async ({ owner, repo, path, ref }) => {
      try {
        const files = await github.listFiles(owner, repo, path, ref);
        const list = files
          .map((f) => `${f.type === 'dir' ? '📁' : '📄'} ${f.path}`)
          .join('\n');
        return { content: [{ type: 'text', text: list }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Error: ${err.message}` }]
        };
      }
    }
  );

  // --- GitLab ---

  server.tool(
    'gitlab_get_file',
    {
      project: z
        .string()
        .describe(
          "Project ID or URL-encoded path, e.g. '12345' or 'group/project'"
        ),
      path: z.string().describe('File path'),
      ref: z
        .string()
        .optional()
        .describe('Branch or commit SHA, defaults to main')
    },
    async ({ project, path, ref }) => {
      try {
        const result = await gitlab.getFile(project, path, ref);
        return {
          content: [
            {
              type: 'text',
              text: `📄 ${result.path} (${result.size} bytes)\n\n${result.content}`
            }
          ]
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Error: ${err.message}` }]
        };
      }
    }
  );

  server.tool(
    'gitlab_list_files',
    {
      project: z.string().describe('Project ID or path'),
      path: z.string().optional().describe('Directory path, empty for root'),
      ref: z.string().optional().describe('Branch or commit SHA')
    },
    async ({ project, path, ref }) => {
      try {
        const files = await gitlab.listFiles(project, path, ref);
        const list = files
          .map((f) => `${f.type === 'tree' ? '📁' : '📄'} ${f.path}`)
          .join('\n');
        return { content: [{ type: 'text', text: list }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Error: ${err.message}` }]
        };
      }
    }
  );

  server.tool(
    'gitlab_search_code',
    {
      project: z
        .string()
        .describe("Project ID or path, e.g. 'live-activity/nuwa'"),
      searchKey: z.string().describe('Search keyword')
    },
    async ({ project, searchKey }) => {
      try {
        const results = await gitlab.searchCode(project, searchKey);
        const list = results
          .map(
            (f) =>
              `📄 ${f.path}:${f.startline}\n   ${f.data.trim().slice(0, 120)}`
          )
          .join('\n\n');
        return { content: [{ type: 'text', text: list || '没有找到结果' }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Error: ${err.message}` }]
        };
      }
    }
  );

  // --- Figma ---

  server.tool(
    'figma_inspect',
    {
      figmaUrl: z.string().describe('Figma design URL'),
      prefix: z
        .string()
        .optional()
        .describe('Node name prefix to match, defaults to "D2C-"')
    },
    async ({ figmaUrl, prefix }) => {
      try {
        const result = await figma.inspect(figmaUrl, prefix || 'D2C-');
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Error: ${err.message}` }]
        };
      }
    }
  );

  server.tool(
    'figma_tree',
    {
      figmaUrl: z.string().describe('Figma design URL'),
      keywords: z
        .string()
        .optional()
        .describe('Comma-separated keywords to filter by node name'),
      types: z
        .string()
        .optional()
        .describe('Comma-separated node types, e.g. FRAME,INSTANCE,TEXT'),
      maxWidth: z.number().optional().describe('Max node width filter'),
      maxHeight: z.number().optional().describe('Max node height filter'),
      depth: z.number().optional().describe('Max tree depth, defaults to 99'),
      showColor: z.boolean().optional().describe('Show SOLID fill hex color')
    },
    async ({
      figmaUrl,
      keywords,
      types,
      maxWidth,
      maxHeight,
      depth,
      showColor
    }) => {
      try {
        const result = await figma.tree(figmaUrl, {
          keywords,
          types,
          maxWidth,
          maxHeight,
          depth,
          showColor
        });
        return {
          content: [
            {
              type: 'text',
              text: `${result.nodeCount} nodes\n\n${result.tree}`
            }
          ]
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Error: ${err.message}` }]
        };
      }
    }
  );

  server.tool(
    'figma_images',
    {
      figmaUrl: z.string().describe('Figma design URL'),
      nodeIds: z.array(z.string()).describe('Array of node IDs to export'),
      scale: z.number().optional().describe('Export scale, defaults to 2'),
      format: z
        .string()
        .optional()
        .describe('Export format: png, jpg, svg, pdf. Defaults to png')
    },
    async ({ figmaUrl, nodeIds, scale, format }) => {
      try {
        const result = await figma.images(
          figmaUrl,
          nodeIds,
          scale || 2,
          format || 'png'
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Error: ${err.message}` }]
        };
      }
    }
  );

  server.tool(
    'figma_export',
    {
      figmaUrl: z.string().describe('Figma design URL'),
      mapping: z
        .record(z.string(), z.string())
        .describe('Map of nodeId → output file path'),
      scale: z.number().optional().describe('Export scale, defaults to 2'),
      format: z.string().optional().describe('Export format, defaults to png')
    },
    async ({ figmaUrl, mapping, scale, format }) => {
      try {
        const result = await figma.exportImages(
          figmaUrl,
          mapping,
          scale || 2,
          format || 'png'
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Error: ${err.message}` }]
        };
      }
    }
  );

  server.tool(
    'figma_text',
    {
      figmaUrl: z.string().describe('Figma design URL'),
      keywords: z
        .string()
        .optional()
        .describe('Comma-separated keywords to filter TEXT nodes'),
      depth: z.number().optional().describe('Max tree depth, defaults to 99')
    },
    async ({ figmaUrl, keywords, depth }) => {
      try {
        const result = await figma.extractText(figmaUrl, { keywords, depth });
        const summary = result.texts
          .map((t) => {
            const hl = t.highlights.length
              ? ` (${t.highlights.length} highlights)`
              : '';
            return `"${t.text}" | color:${t.baseColor}${hl} | ${t.width}x${t.height} | id:${t.id}`;
          })
          .join('\n');
        return {
          content: [
            { type: 'text', text: `${result.count} TEXT nodes\n\n${summary}` }
          ]
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Error: ${err.message}` }]
        };
      }
    }
  );

  // --- Vision / Image Recognition ---

  server.tool(
    'image_recognize',
    {
      imagePath: z.string().describe('Absolute path to the image file'),
      prompt: z
        .string()
        .optional()
        .describe('Custom prompt for API-based recognition (ignored for local OCR)'),
      lang: z
        .string()
        .optional()
        .describe('OCR languages, comma-separated, e.g. "zh-Hans,en" (local OCR only)')
    },
    async ({ imagePath, prompt, lang }) => {
      try {
        const result = await vision.recognizeImage(imagePath, { prompt, lang });
        const header = `🔍 Provider: ${result.provider}${result.model ? ` (${result.model})` : ''}`;
        return {
          content: [{ type: 'text', text: `${header}\n\n${result.text}` }]
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Error: ${err.message}` }]
        };
      }
    }
  );
}
