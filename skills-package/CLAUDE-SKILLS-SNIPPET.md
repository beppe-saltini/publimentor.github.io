# Custom Skills for Claude Code

## Available Skills

The following custom skills are available in `.claude/skills/`. Read the relevant `SKILL.md` before starting any task that matches the skill's domain.

### frontend-design
- **Path**: `.claude/skills/frontend-design/SKILL.md`
- **When to use**: Building web components, pages, dashboards, React components, HTML/CSS layouts, landing pages, or styling/beautifying any web UI
- **What it does**: Guides creation of distinctive, production-grade frontend interfaces with high design quality that avoids generic AI aesthetics

### mcp-builder
- **Path**: `.claude/skills/mcp-builder/SKILL.md`
- **When to use**: Building MCP (Model Context Protocol) servers to integrate external APIs or services, whether in Python (FastMCP) or TypeScript (MCP SDK)
- **What it does**: Complete guide for creating high-quality MCP servers — from planning through implementation, testing, and evaluation
- **Reference files**:
  - `.claude/skills/mcp-builder/reference/mcp_best_practices.md` — Naming, response formats, pagination, transport, security
  - `.claude/skills/mcp-builder/reference/node_mcp_server.md` — TypeScript implementation patterns
  - `.claude/skills/mcp-builder/reference/python_mcp_server.md` — Python/FastMCP implementation patterns
  - `.claude/skills/mcp-builder/reference/evaluation.md` — Creating evaluation test suites

### web-artifacts-builder
- **Path**: `.claude/skills/web-artifacts-builder/SKILL.md`
- **When to use**: Creating elaborate, multi-component web artifacts using React, Tailwind CSS, and shadcn/ui — especially self-contained HTML bundles
- **What it does**: Workflow for initializing, developing, and bundling React apps into single HTML files

## Skill Usage Rules

1. **Always read the SKILL.md** before starting work on a task that matches a skill's domain
2. **Read reference files** when you need deeper implementation guidance
3. **Multiple skills may apply** — e.g., use both `frontend-design` and `web-artifacts-builder` when building a polished web artifact
4. **Skills complement CLAUDE.md** — they don't replace project-level architecture standards
