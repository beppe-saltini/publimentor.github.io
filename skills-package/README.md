# Skills Package: MCP Builder + Web Artifacts Builder + Frontend Design

This package gives you three powerful skills for both **Cursor IDE** and **Claude Code CLI**.

---

## What's Included

| Skill | Purpose |
|-------|---------|
| **frontend-design** | Production-grade UI design with distinctive aesthetics (anti-AI-slop) |
| **mcp-builder** | Build MCP servers for LLM tool integrations (TypeScript/Python) |
| **web-artifacts-builder** | Bundle React + Tailwind + shadcn/ui apps into single HTML files |

---

## Setup for Cursor IDE

Copy the `.cursor/rules/` files into your project root:

```bash
# From your project root
cp -r .cursor/rules/*.mdc <your-project>/.cursor/rules/
```

### How Cursor Rules Work

These are configured as **Auto Attached** rules with glob patterns:

| Rule File | Triggers When You Edit |
|-----------|----------------------|
| `frontend-design.mdc` | `*.tsx`, `*.jsx`, `*.css`, `components/**`, `pages/**` |
| `mcp-builder.mdc` | `**/mcp/**`, `**/*-mcp-server*/**` |
| `web-artifacts-builder.mdc` | `**/artifacts/**`, `**/bundle.html` |

They activate automatically based on the files you're working with — no extra tokens wasted when they're not relevant.

### Manual Activation

You can also reference any rule manually in Cursor chat:
```
@mcp-builder help me build an MCP server for the Notion API
@frontend-design make this dashboard look polished and distinctive
```

---

## Setup for Claude Code CLI

### Step 1: Copy the Skills Directory

```bash
# From your project root
cp -r .claude/ <your-project>/.claude/
```

### Step 2: Add to Your CLAUDE.md

Append the contents of `CLAUDE-SKILLS-SNIPPET.md` to your project's `CLAUDE.md` file:

```bash
cat CLAUDE-SKILLS-SNIPPET.md >> <your-project>/CLAUDE.md
```

Or manually copy the relevant section into your existing `CLAUDE.md`.

### Step 3: Verify

Run Claude Code and ask it to list available skills:
```bash
claude "What custom skills do I have available?"
```

It should reference all three skills and know when to use them.

---

## Directory Structure

```
.cursor/
  rules/
    frontend-design.mdc        # Cursor auto-attached rule
    mcp-builder.mdc             # Cursor auto-attached rule
    web-artifacts-builder.mdc   # Cursor auto-attached rule

.claude/
  skills/
    frontend-design/
      SKILL.md                  # Original Anthropic skill file
    mcp-builder/
      SKILL.md                  # Original Anthropic skill file
      reference/
        mcp_best_practices.md   # Naming, pagination, transport, security
        node_mcp_server.md      # TypeScript implementation guide (28K)
        python_mcp_server.md    # Python/FastMCP guide (25K)
        evaluation.md           # Evaluation test suite creation (22K)
    web-artifacts-builder/
      SKILL.md                  # Original Anthropic skill file

CLAUDE-SKILLS-SNIPPET.md        # Paste into your CLAUDE.md
README.md                       # This file
```

---

## Usage Tips

### Combining Skills
Skills work best in combination:
- **Frontend Design + Web Artifacts Builder** → Polished, self-contained web apps
- **MCP Builder + Frontend Design** → Beautiful admin UIs for your MCP servers
- **All three** → Build an MCP server, create a test dashboard, bundle it all

### With Your Enterprise Architecture Standards
If you're using the enterprise CLAUDE.md we built earlier, these skills complement it:
- Frontend Design enforces the UI quality standards
- MCP Builder follows the integration architecture patterns
- Web Artifacts Builder handles the build/bundle infrastructure

### Cursor-Specific Tips
- Rules auto-attach based on file globs, keeping context lean
- Use `@ruleName` in chat to force-load a rule when globs don't match
- Edit the `globs` in the frontmatter to match your project structure

### Claude Code-Specific Tips
- Claude Code reads `.claude/skills/` when referenced in CLAUDE.md
- Reference files are loaded on-demand (Claude reads SKILL.md first, then dives into references)
- You can add more skills to `.claude/skills/` following the same pattern
