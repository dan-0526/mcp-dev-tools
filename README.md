# mcp-dev-tools

通过 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 聚合 GitHub / GitLab / Figma 等开发工具的 Server。

支持所有兼容 MCP 的客户端：Claude Code、Codex、VS Code (Copilot)、Kiro、Cursor 等。

## 提供的工具

| 工具 | 说明 |
|------|------|
| `github_get_file` | 获取 GitHub 仓库中指定文件的内容 |
| `github_list_files` | 列出 GitHub 仓库的文件目录 |
| `github_search_code` | 搜索 GitHub 仓库代码 |
| `gitlab_get_file` | 获取 GitLab 仓库中指定文件的内容 |
| `gitlab_list_files` | 列出 GitLab 仓库的文件目录 |
| `gitlab_search_code` | 搜索 GitLab 仓库代码 |
| `figma_inspect` | 按前缀查找 Figma 设计稿中的节点 |
| `figma_tree` | 浏览 Figma 节点树（支持过滤） |
| `figma_images` | 获取 Figma 节点导出图片 URL |
| `figma_export` | 批量导出 Figma 节点图片（返回 URL + 映射） |
| `figma_text` | 提取 Figma 设计稿中的文字、颜色和高亮 |
| `codex_exec` | 调用 Codex CLI 执行独立任务 |
| `claude_exec` | 调用 Claude Code CLI 执行独立任务，支持 direct / relay 模式 |

## 快速安装

> 需要 Node.js ≥ 18.0，可通过 `node -v` 检查版本。

```bash
git clone https://github.com/dan-0526/mcp-dev-tools.git ~/mcp-dev-tools
cd ~/mcp-dev-tools
npm install
```

## 获取 Token

按需准备，不用的平台留空即可：

- **GitHub**: https://github.com/settings/tokens → Generate new token (classic) → 勾选 `repo`
- **GitLab**: GitLab → Preferences → Access Tokens → 勾选 `read_repository`
- **Figma**: Figma → 左上角头像 → Settings → Personal access tokens → Generate new token

> ⚠️ Token 不要提交到仓库，通过各客户端的 env 配置传入。

## Claude Relay

`claude_exec` 默认使用 `direct` 模式：MCP server 进程直接执行 `claude -p`。默认会清理 `HTTP_PROXY` / `HTTPS_PROXY` / `http_proxy` / `https_proxy`，避免本机代理环境影响 Claude Code CLI。确实需要保留代理时，可以传 `preserveProxyEnv: true`。

如果 MCP 客户端所在环境无法直接运行 Claude，可以改用 `relay` 模式：在正常网络环境中单独启动 relay server，让 MCP 通过 HTTP 转发任务。

启动 relay：

```bash
cd /path/to/mcp-dev-tools
CLAUDE_RELAY_TOKEN=<shared-secret> npm run claude-relay
```

默认监听 `http://127.0.0.1:38765`。如果客户端不能访问 `127.0.0.1`，可以显式设置：

```bash
CLAUDE_RELAY_HOST=<reachable-host>
CLAUDE_RELAY_PORT=38765
CLAUDE_RELAY_TOKEN=<shared-secret>
npm run claude-relay
```

MCP server 侧配置：

```bash
CLAUDE_EXEC_MODE=relay
CLAUDE_RELAY_URL=http://<reachable-host>:38765
CLAUDE_RELAY_TOKEN=<shared-secret>
```

安全提醒：不要在无 token 的情况下把 relay 绑定到局域网地址或 `0.0.0.0`。

---

## 客户端配置

选择你使用的客户端，复制命令到终端执行。**执行前先替换 `<...>` 占位符为你自己的值。**

> 路径示例：如果你 clone 到了 `~/mcp-dev-tools`，那绝对路径就是 `/Users/yourname/mcp-dev-tools/src/index.js`，macOS 下可以通过 `pwd` 命令查看。

### Claude Code

```bash
claude mcp add dev-tools \
  -e GITHUB_TOKEN=<your-github-token> \
  -e GITLAB_TOKEN=<your-gitlab-token> \
  -e GITLAB_URL=https://gitlab.com \
  -e FIGMA_TOKEN=<your-figma-token> \
  -- node <绝对路径>/mcp-dev-tools/src/index.js
```

### VS Code (GitHub Copilot)

在项目根目录执行：

```bash
mkdir -p .vscode
cat > .vscode/mcp.json << 'EOF'
{
  "servers": {
    "dev-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["<绝对路径>/mcp-dev-tools/src/index.js"],
      "env": {
        "GITHUB_TOKEN": "<your-github-token>",
        "GITLAB_TOKEN": "<your-gitlab-token>",
        "GITLAB_URL": "https://gitlab.com",
        "FIGMA_TOKEN": "<your-figma-token>"
      }
    }
  }
}
EOF
```

### Codex CLI

```bash
mkdir -p ~/.codex
cat >> ~/.codex/config.toml << 'EOF'

[mcp_servers.dev-tools]
command = "node"
args = ["<绝对路径>/mcp-dev-tools/src/index.js"]
env = { "GITHUB_TOKEN" = "<your-github-token>", "GITLAB_TOKEN" = "<your-gitlab-token>", "GITLAB_URL" = "https://gitlab.com", "FIGMA_TOKEN" = "<your-figma-token>" }
EOF
```

### Kiro / Cursor

这两个客户端格式相同，区别只在配置文件路径：

| 客户端 | 配置文件路径 |
|--------|-------------|
| Kiro（全局） | `~/.kiro/settings/mcp.json` |
| Kiro（工作区） | `.kiro/settings/mcp.json` |
| Cursor | `~/.cursor/mcp.json` |

配置内容（以 Kiro 全局为例）：

```bash
mkdir -p ~/.kiro/settings
cat > ~/.kiro/settings/mcp.json << 'EOF'
{
  "mcpServers": {
    "dev-tools": {
      "command": "node",
      "args": ["<绝对路径>/mcp-dev-tools/src/index.js"],
      "env": {
        "GITHUB_TOKEN": "<your-github-token>",
        "GITLAB_TOKEN": "<your-gitlab-token>",
        "GITLAB_URL": "https://gitlab.com",
        "FIGMA_TOKEN": "<your-figma-token>"
      }
    }
  }
}
EOF
```

Cursor 只需把路径改为 `~/.cursor/mcp.json`。

---

## 项目结构

```
mcp-dev-tools/
├── src/
│   ├── index.js      # 入口，启动 MCP Server
│   ├── tools.js      # 工具注册
│   ├── github.js     # GitHub API 封装
│   ├── gitlab.js     # GitLab API 封装
│   └── figma.js      # Figma API 封装
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 使用示例

配置好后，在聊天中直接说：

- "帮我看看 github 上 facebook/react 的 package.json"
- "列出 gitlab 项目 mygroup/myproject 的 src 目录"
- "看一下这个 Figma 设计稿的节点树：https://www.figma.com/design/xxx"
- "提取这个 Figma 页面里的所有文字内容"

## License

MIT
