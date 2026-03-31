# opencode-autobe

<p align="center">
  <img src="logo.svg" alt="opencode-autobe logo" width="160" height="160"/>
</p>

An [OpenCode](https://opencode.ai) plugin that integrates [AutoBE](https://autobe.dev) — the AI-powered NestJS + Prisma backend generator — directly into your OpenCode sessions. Runs entirely in-process. No playground server required.

## What it does

Adds the `autobe_generate` tool to OpenCode. Run the full AutoBE pipeline from a single natural-language description:

| Phase | Output |
|-------|--------|
| **Requirements analysis** | Structured specification |
| **Database design** | Type-safe Prisma schema (ERD) |
| **API design** | OpenAPI specification |
| **Test generation** | E2E test suites |
| **Code generation** | 100% TypeScript-compilable NestJS implementation |

All files are written to your current project directory.

## Prerequisites

- **AI API key** — Anthropic (recommended), OpenAI, or any OpenAI-compatible provider

That's it. No server to start, no ports to configure.

## Installation

### Via npm (recommended)

Add to your `opencode.json`:

```json
{
  "plugins": ["@hacr/opencode-autobe"]
}
```

### Local development

Clone this repo and place the project in your working directory. OpenCode will auto-load `.opencode/plugins/autobe.ts`.

## Configuration

Set your AI API key:

```bash
# Anthropic (recommended - uses Claude Sonnet 4)
export ANTHROPIC_API_KEY=sk-ant-...

# Or OpenAI
export OPENAI_API_KEY=sk-...
```

Optional overrides:

| Variable | Description |
|----------|-------------|
| `AUTOBE_API_KEY` | Generic API key (used if vendor-specific keys not set) |
| `AUTOBE_MODEL` | Override default model (e.g., `claude-sonnet-4-20250514`, `gpt-4.1`) |
| `AUTOBE_BASE_URL` | Custom endpoint for OpenAI-compatible providers |

## Usage

Once configured, just describe your backend:

```
Generate a backend for a blog platform with posts, comments, tags, and user auth
```

OpenCode runs `autobe_generate` and executes the full AutoBE pipeline in-process. Progress is streamed live:

```
AutoBE: analysing requirements…
AutoBE: ✓ requirements analysed
AutoBE: designing database schema…
AutoBE: ✓ database schema done
AutoBE: designing API interface…
AutoBE: ✓ API interface done
AutoBE: writing E2E tests…
AutoBE: ✓ E2E tests done
AutoBE: generating implementation…
AutoBE: ✓ implementation done!
```

All generated files (Prisma schema, controllers, services, tests, etc.) are written to your project directory.

## Architecture

**Old:** Plugin → HTTP/WebSocket → Playground Server → AutoBE SDK → files

**New:** Plugin → AutoBE SDK → files

By embedding `@autobe/agent` and `@autobe/compiler` as dependencies, the pipeline runs directly in your OpenCode process. Zero configuration, zero latency, zero external services.

## AutoBE pipeline

AutoBE uses a waterfall + spiral architecture with compiler-driven validation:

```
Requirements → Prisma Schema → OpenAPI Spec → E2E Tests → NestJS Implementation
     ↑               ↑               ↑             ↑               ↑
  Analyze         Database        Interface       Test           Realize
```

Each phase validates against its compiler (Prisma → OpenAPI → TypeScript) before proceeding, ensuring 100% compilable output.

## License

MIT
