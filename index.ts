/**
 * opencode-autobe — OpenCode plugin for AutoBE
 *
 * Adds three tools to OpenCode:
 *   - autobe_generate     Run the full AutoBE pipeline from a description
 *   - autobe_list_sessions List recent sessions on the playground server
 *   - autobe_get_files    Retrieve + write files from a completed session
 *
 * Configuration (environment variables):
 *   AUTOBE_SERVER_URL   Playground server base URL (default: http://localhost:3000)
 *   AUTOBE_VENDOR_ID    Re-use an existing vendor ID (skips vendor creation)
 *   AUTOBE_API_KEY      API key for AI vendor (fallback: ANTHROPIC_API_KEY / OPENAI_API_KEY)
 *   AUTOBE_BASE_URL     Custom base URL for the AI vendor endpoint (optional)
 *   AUTOBE_MODEL        Default AI model (default: claude-sonnet-4-20250514)
 */

import { tool, type Plugin } from "@opencode-ai/plugin";
import { WebSocketConnector } from "tgrid";
import { join } from "path";
import { writeFile, mkdir } from "fs/promises";

// ---------------------------------------------------------------------------
// HTTP helpers — minimal raw-fetch wrappers for the AutoBE playground API
// ---------------------------------------------------------------------------

async function apiCall(
  serverUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`AutoBE API ${method} ${path} → ${res.status}: ${detail}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// WebSocket / TGrid helpers
// ---------------------------------------------------------------------------

/**
 * Connect to an AutoBE session, send `message`, wait for generation to finish,
 * then fetch the generated files — all in one connection.
 */
async function runSession(
  serverUrl: string,
  sessionId: string,
  message: string,
  onEvent: (name: string, data: unknown) => void,
): Promise<Record<string, string>> {
  const wsBase = serverUrl.replace(/^http/, "ws");
  const url = `${wsBase}/autobe/playground/sessions/${sessionId}/connect`;

  // Proxy provider: forwards every event name to `onEvent`
  const provider = new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      return (data: unknown) => {
        try {
          onEvent(prop, data);
        } catch {
          /* swallow listener errors */
        }
      };
    },
    has() {
      return true; // tgrid checks hasOwnProperty; tell it every method exists
    },
  });

  const connector = new WebSocketConnector<null, typeof provider, object>(
    null,
    provider,
  );

  await connector.connect(url);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driver = connector.getDriver() as any;

  try {
    // conversate() is async and resolves only after the full pipeline finishes
    await driver.conversate(message);
    const files = (await driver.getFiles()) as Record<string, string>;
    return files;
  } finally {
    await connector.close();
  }
}

/**
 * Connect to an already-completed session and retrieve its generated files.
 */
async function fetchFiles(
  serverUrl: string,
  sessionId: string,
): Promise<Record<string, string>> {
  const wsBase = serverUrl.replace(/^http/, "ws");
  const url = `${wsBase}/autobe/playground/sessions/${sessionId}/connect`;

  const provider = new Proxy({} as Record<string, unknown>, {
    get() {
      return () => {};
    },
    has() {
      return true;
    },
  });

  const connector = new WebSocketConnector<null, typeof provider, object>(
    null,
    provider,
  );

  await connector.connect(url);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driver = connector.getDriver() as any;

  try {
    return (await driver.getFiles()) as Record<string, string>;
  } finally {
    await connector.close();
  }
}

// ---------------------------------------------------------------------------
// Vendor bootstrap helper
// ---------------------------------------------------------------------------

async function ensureVendor(serverUrl: string): Promise<string> {
  if (process.env.AUTOBE_VENDOR_ID) return process.env.AUTOBE_VENDOR_ID;

  // Look for an existing "opencode-autobe" vendor
  const page = (await apiCall(serverUrl, "PATCH", "/autobe/playground/vendors", {
    limit: 100,
  })) as { data?: Array<{ id: string; name: string; deleted_at: null | string }> };

  const existing = (page.data ?? []).find(
    (v) => v.name === "opencode-autobe" && v.deleted_at === null,
  );
  if (existing) return existing.id;

  // Create a new vendor using the first available API key
  const apiKey =
    process.env.AUTOBE_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "No API key found. Set AUTOBE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.",
    );
  }

  const vendor = (await apiCall(serverUrl, "POST", "/autobe/playground/vendors", {
    name: "opencode-autobe",
    apiKey,
    baseURL: process.env.AUTOBE_BASE_URL ?? null,
    semaphore: 16,
  })) as { id: string };

  return vendor.id;
}

// ---------------------------------------------------------------------------
// Write helper
// ---------------------------------------------------------------------------

async function writeFiles(
  directory: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    const full = join(directory, filePath);
    const dir = full.substring(0, full.lastIndexOf("/"));
    if (dir) await mkdir(dir, { recursive: true });
    await writeFile(full, content, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: Plugin = async (_ctx) => {
  const serverUrl = (
    process.env.AUTOBE_SERVER_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");

  return {
    tool: {
      // -----------------------------------------------------------------------
      autobe_generate: tool({
        description: `Generate a complete NestJS + Prisma backend using AutoBE AI.

Runs the full AutoBE vibe-coding pipeline:
  1. Requirements analysis   → structured specification
  2. Database design         → Prisma schema (ERD)
  3. API design              → OpenAPI specification
  4. Test generation         → E2E test suites
  5. Code generation         → NestJS implementation (100 % TypeScript-compilable)

All generated files are written to the current project directory by default.

Prerequisites:
  • AutoBE playground server running (AUTOBE_SERVER_URL, default http://localhost:3000)
  • AI API key in AUTOBE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY`,

        args: {
          description: tool.schema
            .string()
            .describe(
              "Natural-language description of the backend to generate. " +
                "Include domain, main entities, key operations, and any constraints.",
            ),
          model: tool.schema
            .string()
            .optional()
            .describe(
              "AI model, e.g. 'claude-sonnet-4-20250514', 'gpt-4.1', 'qwen3-235b-a22b'. " +
                "Defaults to AUTOBE_MODEL env var or 'claude-sonnet-4-20250514'.",
            ),
          write_files: tool.schema
            .boolean()
            .optional()
            .describe("Write generated files to the project directory. Default: true."),
          title: tool.schema
            .string()
            .optional()
            .describe("Optional session title for the AutoBE playground."),
        },

        async execute(args, ctx) {
          const model =
            args.model ?? process.env.AUTOBE_MODEL ?? "claude-sonnet-4-20250514";
          const shouldWrite = args.write_files !== false;

          ctx.metadata({ title: "AutoBE: setting up…" });

          // 1. Vendor
          let vendorId: string;
          try {
            vendorId = await ensureVendor(serverUrl);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return [
              "❌ AutoBE vendor setup failed: " + msg,
              "",
              "Checklist:",
              `  1. Playground server at ${serverUrl}/monitors/health`,
              "  2. Set AUTOBE_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY",
            ].join("\n");
          }

          // 2. Session
          let session: { id: string };
          try {
            session = (await apiCall(serverUrl, "POST", "/autobe/playground/sessions", {
              vendor_id: vendorId,
              model,
              title: args.title ?? args.description.slice(0, 80),
              locale: "en-US",
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })) as { id: string };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return "❌ Failed to create AutoBE session: " + msg;
          }

          ctx.metadata({
            title: "AutoBE: generating…",
            metadata: { sessionId: session.id },
          });

          // Phase label map for progress display
          const phaseLabels: Record<string, string> = {
            analyzeStart: "AutoBE: analysing requirements…",
            databaseStart: "AutoBE: designing database schema…",
            interfaceStart: "AutoBE: designing API interface…",
            testStart: "AutoBE: writing E2E tests…",
            realizeStart: "AutoBE: generating implementation…",
            analyzeComplete: "AutoBE: ✓ requirements analysed",
            databaseComplete: "AutoBE: ✓ database schema done",
            interfaceComplete: "AutoBE: ✓ API interface done",
            testComplete: "AutoBE: ✓ E2E tests done",
            realizeComplete: "AutoBE: ✓ implementation done!",
          };

          let lastLabel = "";

          // 3. Run generation
          let files: Record<string, string>;
          try {
            files = await runSession(
              serverUrl,
              session.id,
              args.description,
              (name) => {
                const label = phaseLabels[name];
                if (label && label !== lastLabel) {
                  lastLabel = label;
                  ctx.metadata({ title: label });
                }
              },
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return [
              "❌ AutoBE generation failed: " + msg,
              "",
              `Session ID: ${session.id}`,
              `Review at: ${serverUrl}`,
            ].join("\n");
          }

          const fileList = Object.keys(files);

          // 4. Write files
          if (shouldWrite && fileList.length > 0) {
            await writeFiles(ctx.directory, files);
          }

          return [
            "✅ AutoBE generation complete!",
            "",
            `Session:  ${session.id}`,
            `Model:    ${model}`,
            `Files:    ${fileList.length}`,
            "",
            "Generated files:",
            ...fileList.slice(0, 30).map((f) => `  ${f}`),
            ...(fileList.length > 30
              ? [`  … and ${fileList.length - 30} more`]
              : []),
            "",
            shouldWrite && fileList.length > 0
              ? `✓ Written to: ${ctx.directory}`
              : "(write_files=false — files not written to disk)",
          ].join("\n");
        },
      }),

      // -----------------------------------------------------------------------
      autobe_list_sessions: tool({
        description:
          "List recent AutoBE sessions from the playground server. " +
          "Requires AutoBE playground server running at AUTOBE_SERVER_URL (default: http://localhost:3000).",

        args: {
          limit: tool.schema
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe("Maximum sessions to return (default: 10, max: 50)."),
        },

        async execute(args) {
          let page: { data?: Array<{
            id: string;
            title: string | null;
            model: string;
            phase: string | null;
            created_at: string;
          }> };

          try {
            page = (await apiCall(serverUrl, "PATCH", "/autobe/playground/sessions", {
              limit: args.limit ?? 10,
            })) as typeof page;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return (
              `❌ Failed to list sessions: ${msg}\n\n` +
              `Is AutoBE playground running at ${serverUrl}?`
            );
          }

          const sessions = page.data ?? [];
          if (sessions.length === 0) return "No AutoBE sessions found.";

          return sessions
            .map((s) =>
              [
                `ID:      ${s.id}`,
                `  Title:   ${s.title ?? "(untitled)"}`,
                `  Model:   ${s.model}`,
                `  Phase:   ${s.phase ?? "not started"}`,
                `  Created: ${new Date(s.created_at).toLocaleString()}`,
              ].join("\n"),
            )
            .join("\n\n");
        },
      }),

      // -----------------------------------------------------------------------
      autobe_get_files: tool({
        description:
          "Retrieve generated files from a completed AutoBE session and " +
          "write them to the current project directory.",

        args: {
          session_id: tool.schema
            .string()
            .describe("AutoBE session ID (from autobe_list_sessions or autobe_generate output)."),
          write_files: tool.schema
            .boolean()
            .optional()
            .describe("Write files to the project directory. Default: true."),
        },

        async execute(args, ctx) {
          let files: Record<string, string>;
          try {
            files = await fetchFiles(serverUrl, args.session_id);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return `❌ Failed to get files for session ${args.session_id}: ${msg}`;
          }

          const fileList = Object.keys(files);
          if (fileList.length === 0) {
            return (
              `No files found in session ${args.session_id}.\n` +
              "The session may not have completed generation yet."
            );
          }

          const shouldWrite = args.write_files !== false;
          if (shouldWrite) {
            await writeFiles(ctx.directory, files);
          }

          return [
            `✅ ${fileList.length} files from session ${args.session_id}`,
            "",
            "Files:",
            ...fileList.slice(0, 30).map((f) => `  ${f}`),
            ...(fileList.length > 30
              ? [`  … and ${fileList.length - 30} more`]
              : []),
            "",
            shouldWrite
              ? `✓ Written to: ${ctx.directory}`
              : "(write_files=false — files not written)",
          ].join("\n");
        },
      }),
    },
  };
};

export default plugin;
