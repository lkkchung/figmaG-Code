# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Figma plugin that converts vector graphics to G-Code for CNC machines/plotters. Currently contains template code (rectangle creator) that needs to be replaced with actual vector-to-G-code conversion logic.

## Build Commands

All commands run from `Vector to G-Code/` directory:

```bash
npm run build      # Compile TypeScript to JavaScript
npm run watch      # Watch mode for development
npm run lint       # Run ESLint
npm run lint:fix   # Auto-fix linting issues
```

## Architecture

**Two-context Figma plugin architecture:**

1. **Plugin context** (`code.ts` → `code.js`): Runs in Figma's sandbox with access to the `figma` global object and document API. Cannot access browser APIs directly.

2. **UI context** (`ui.html`): Runs in a browser iframe with full DOM/browser API access. Cannot access Figma document directly.

**Communication:** Contexts communicate via message passing:
- UI → Plugin: `parent.postMessage({ pluginMessage: {...} }, '*')`
- Plugin → UI: `figma.ui.postMessage({...})`
- Plugin listens: `figma.ui.onmessage = (msg) => {...}`

**Key files:**
- `manifest.json` - Plugin metadata, permissions, entry points
- `code.ts` - Main plugin logic (document manipulation)
- `ui.html` - User interface

## Workflow

This project uses **bd** (beads) for issue tracking. See AGENTS.md for full workflow details.

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

**Session completion is mandatory:** Work is NOT complete until `git push` succeeds.
