/**
 * MCP server factory for the Datto BCDR MCP server.
 *
 * Builds a fresh Server instance per call (required for stateless HTTP
 * mode) with the full tool ladder, plus the MCP Apps (SEP-1865) surface:
 * a ui:// device card resource and a normalized `_card` payload attached
 * to datto_bcdr_get_device results.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DattoBcdrClient } from "@wyre-technology/node-datto-bcdr";
import { setServerRef } from "./utils/server-ref.js";
import { elicitSelection, elicitText } from "./utils/elicitation.js";
import {
  DEVICE_CARD_META,
  DEVICE_CARD_RESOURCE_URI,
  MCP_APP_RESOURCE_MIME,
  applyBrandInjection,
  brandFromEnv,
  buildDeviceCard,
  type DeviceCard,
} from "./device-card.js";
import { DEVICE_CARD_HTML } from "./generated/device-card-html.js";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface DattoBcdrCredentials {
  publicKey: string;
  privateKey: string;
}

function getCredentials(): DattoBcdrCredentials | null {
  const publicKey = process.env.DATTO_BCDR_PUBLIC_KEY;
  const privateKey = process.env.DATTO_BCDR_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey };
}

function createClient(creds: DattoBcdrCredentials): DattoBcdrClient {
  // The Datto BCDR API uses "public/private key" in its docs but the SDK
  // mirrors node-datto-rmm naming (apiKey/apiSecretKey). Translate at the
  // boundary so user-facing credential labels stay consistent with Datto's.
  return new DattoBcdrClient({
    apiKey: creds.publicKey,
    apiSecretKey: creds.privateKey,
  });
}

// ---------------------------------------------------------------------------
// Server factory — fresh server per request (stateless HTTP mode)
// ---------------------------------------------------------------------------

export function createMcpServer(credentialOverrides?: DattoBcdrCredentials): Server {
  const server = new Server(
    {
      name: "datto-bcdr-mcp",
      version: "0.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  setServerRef(server);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "datto_bcdr_list_devices",
          description: "List all SIRIS/Alto BCDR appliances in the partner portal.",
          inputSchema: {
            type: "object",
            properties: {
              page: { type: "number", description: "Page number (default: 1)", default: 1 },
              perPage: { type: "number", description: "Results per page (default: 250)", default: 250 },
            },
          },
        },
        {
          name: "datto_bcdr_get_device",
          description: "Get details for a specific BCDR appliance by serial number.",
          _meta: DEVICE_CARD_META,
          inputSchema: {
            type: "object",
            properties: {
              serialNumber: { type: "string", description: "The appliance serial number" },
            },
            required: ["serialNumber"],
          },
        },
        {
          name: "datto_bcdr_list_assets",
          description:
            "List protected agents (assets) on a BCDR appliance. If serialNumber is omitted, the user will be prompted to choose or enter one.",
          inputSchema: {
            type: "object",
            properties: {
              serialNumber: { type: "string", description: "Appliance serial number (optional — will elicit if omitted)" },
            },
          },
        },
        {
          name: "datto_bcdr_get_asset",
          description: "Get details for a specific protected agent on an appliance.",
          inputSchema: {
            type: "object",
            properties: {
              serialNumber: { type: "string", description: "Appliance serial number" },
              agentId: { type: "string", description: "Agent identifier" },
            },
            required: ["serialNumber", "agentId"],
          },
        },
        {
          name: "datto_bcdr_list_backups",
          description: "List recovery points / backups for a protected agent on an appliance.",
          inputSchema: {
            type: "object",
            properties: {
              serialNumber: { type: "string", description: "Appliance serial number" },
              agentId: { type: "string", description: "Agent identifier" },
            },
            required: ["serialNumber", "agentId"],
          },
        },
        {
          name: "datto_bcdr_list_screenshots",
          description: "List screenshot verifications for a protected agent.",
          inputSchema: {
            type: "object",
            properties: {
              serialNumber: { type: "string", description: "Appliance serial number" },
              agentId: { type: "string", description: "Agent identifier" },
            },
            required: ["serialNumber", "agentId"],
          },
        },
        {
          name: "datto_bcdr_get_screenshot",
          description:
            "Fetch a specific screenshot verification PNG. Returns base64-encoded image content.",
          inputSchema: {
            type: "object",
            properties: {
              serialNumber: { type: "string", description: "Appliance serial number" },
              agentId: { type: "string", description: "Agent identifier" },
              epoch: {
                type: "number",
                description: "Epoch timestamp of the screenshot to retrieve",
              },
            },
            required: ["serialNumber", "agentId", "epoch"],
          },
        },
        {
          name: "datto_bcdr_get_offsite_status",
          description: "Get off-site sync status for an appliance.",
          inputSchema: {
            type: "object",
            properties: {
              serialNumber: { type: "string", description: "Appliance serial number" },
            },
            required: ["serialNumber"],
          },
        },
        {
          name: "datto_bcdr_list_alerts",
          description:
            "List partner portal alerts. If date range is omitted, the user will be prompted to choose a window.",
          inputSchema: {
            type: "object",
            properties: {
              since: { type: "string", description: "ISO 8601 start datetime (optional)" },
              until: { type: "string", description: "ISO 8601 end datetime (optional)" },
              page: { type: "number", description: "Page number (default: 1)", default: 1 },
              perPage: { type: "number", description: "Results per page (default: 250)", default: 250 },
            },
          },
        },
        {
          name: "datto_bcdr_list_activity",
          description:
            "List activity log entries. If date range is omitted, the user will be prompted.",
          inputSchema: {
            type: "object",
            properties: {
              since: { type: "string", description: "ISO 8601 start datetime (optional)" },
              until: { type: "string", description: "ISO 8601 end datetime (optional)" },
              page: { type: "number", description: "Page number (default: 1)", default: 1 },
              perPage: { type: "number", description: "Results per page (default: 250)", default: 250 },
            },
          },
        },
      ],
    };
  });

  // -------------------------------------------------------------------------
  // MCP Apps (SEP-1865): the ui:// device card is static HTML embedded at
  // build time (src/generated/device-card-html.ts), so it serves identically
  // from stdio and Node HTTP transports.
  // -------------------------------------------------------------------------

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: DEVICE_CARD_RESOURCE_URI,
          name: "Datto BCDR Device Card",
          description:
            "Interactive MCP Apps card rendering a Datto BCDR appliance's backup status",
          mimeType: MCP_APP_RESOURCE_MIME,
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri !== DEVICE_CARD_RESOURCE_URI) {
      throw new Error(`Unknown resource: ${uri}`);
    }
    return {
      contents: [
        {
          uri,
          mimeType: MCP_APP_RESOURCE_MIME,
          // The card ships neutral; operators brand it at serve time via
          // MCP_BRAND_* env vars (no vars = HTML served unchanged).
          text: applyBrandInjection(DEVICE_CARD_HTML, brandFromEnv()),
        },
      ],
    };
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  // Hard cap to keep one tool call from streaming the entire alert/activity
  // history when the user picks "no filter" — a busy partner can have tens of
  // thousands of records.
  const DATE_FILTER_PAGE_CAP = 2000;

  interface DateRangeMs {
    sinceMs?: number;
    untilMs?: number;
  }

  // Datto inconsistently uses ms vs seconds for timestamps; anything below
  // ~1e12 we treat as seconds.
  function normalizeTs(raw: number): number {
    return raw < 1e12 ? raw * 1000 : raw;
  }

  interface PaginatedIterableLike<T> {
    [Symbol.asyncIterator](): AsyncIterator<T>;
  }

  // Datto BCDR's alert + activity endpoints don't accept date query params,
  // so we paginate via the SDK's async iterator and filter per-item. Stops
  // early when the cap is hit so a "no filter" call doesn't enumerate forever.
  async function collectWithDateFilter<T extends { createdAt?: number; timestamp?: number }>(
    iterable: PaginatedIterableLike<T>,
    range: DateRangeMs
  ): Promise<T[]> {
    const sinceMs = range.sinceMs ?? -Infinity;
    const untilMs = range.untilMs ?? Infinity;
    const out: T[] = [];
    for await (const item of iterable) {
      const raw = item.createdAt ?? item.timestamp;
      if (raw != null) {
        const ts = normalizeTs(raw);
        if (ts < sinceMs || ts > untilMs) continue;
      }
      out.push(item);
      if (out.length >= DATE_FILTER_PAGE_CAP) break;
    }
    return out;
  }

  async function resolveDateRange(
    args: { since?: string; until?: string }
  ): Promise<DateRangeMs> {
    if (args.since || args.until) {
      return {
        sinceMs: args.since ? new Date(args.since).getTime() : undefined,
        untilMs: args.until ? new Date(args.until).getTime() : undefined,
      };
    }

    const choice = await elicitSelection(
      "No date range provided. This query can return many results. Choose a window:",
      "range",
      [
        { value: "24h", label: "Last 24 hours" },
        { value: "7d", label: "Last 7 days" },
        { value: "30d", label: "Last 30 days" },
        { value: "custom", label: "Enter custom ISO 8601 dates" },
        { value: "all", label: "No filter (return everything)" },
      ]
    );

    const nowMs = Date.now();
    const PRESET_WINDOWS_MS: Record<string, number> = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    if (!choice || choice === "all") return {};
    if (choice in PRESET_WINDOWS_MS) {
      return { sinceMs: nowMs - PRESET_WINDOWS_MS[choice] };
    }
    if (choice === "custom") {
      const since = await elicitText(
        "Enter the start datetime in ISO 8601 format (e.g. 2025-04-01T00:00:00Z).",
        "since",
        "Start datetime"
      );
      const until = await elicitText(
        "Enter the end datetime in ISO 8601 format (leave blank for now).",
        "until",
        "End datetime"
      );
      return {
        sinceMs: since ? new Date(since).getTime() : undefined,
        untilMs: until ? new Date(until).getTime() : undefined,
      };
    }
    return {};
  }

  async function resolveSerialNumber(
    client: DattoBcdrClient,
    provided?: string
  ): Promise<string | null> {
    if (provided) return provided;

    const choice = await elicitSelection(
      "No appliance serial number provided. How would you like to choose one?",
      "selection",
      [
        { value: "__list__", label: "Pick from a list of appliances" },
        { value: "__enter__", label: "Enter a serial number manually" },
      ]
    );

    if (choice === "__enter__") {
      const sn = await elicitText(
        "Enter the appliance serial number.",
        "serialNumber",
        "BCDR appliance serial number"
      );
      return sn || null;
    }

    if (choice === "__list__") {
      try {
        const devices = await client.devices.list({ page: 1, perPage: 50 });
        const items: Array<{ serialNumber: string; hostname?: string; name?: string }> = Array.isArray(
          (devices as { items?: unknown }).items
        )
          ? ((devices as { items: Array<{ serialNumber: string; hostname?: string; name?: string }> }).items)
          : (Array.isArray(devices) ? (devices as Array<{ serialNumber: string; hostname?: string; name?: string }>) : []);

        if (items.length === 0) return null;

        const options = items.slice(0, 25).map((d) => ({
          value: d.serialNumber,
          label: `${d.serialNumber}${d.hostname ? ` — ${d.hostname}` : d.name ? ` — ${d.name}` : ""}`,
        }));
        const picked = await elicitSelection(
          "Select an appliance:",
          "serialNumber",
          options
        );
        return picked;
      } catch {
        return null;
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Tool call handler
  // -------------------------------------------------------------------------

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const creds = credentialOverrides ?? getCredentials();

    if (!creds) {
      return {
        content: [
          {
            type: "text",
            text:
              "Error: No API credentials provided. Please configure DATTO_BCDR_PUBLIC_KEY and DATTO_BCDR_PRIVATE_KEY environment variables (or pass them as gateway headers).",
          },
        ],
        isError: true,
      };
    }

    const client = createClient(creds);

    try {
      switch (name) {
        case "datto_bcdr_list_devices": {
          const params = (args ?? {}) as { page?: number; perPage?: number };
          const result = await client.devices.list({
            page: params.page ?? 1,
            perPage: params.perPage ?? 250,
          });
          return { content: [{ type: "text", text: JSON.stringify(result ?? [], null, 2) }] };
        }

        case "datto_bcdr_get_device": {
          const { serialNumber } = args as { serialNumber: string };
          const device = await client.devices.get(serialNumber);
          // MCP Apps: attach the normalized payload the ui:// device card
          // renders from. Best-effort — a null card just means no UI surface.
          let card: DeviceCard | null = null;
          try {
            card = buildDeviceCard(device);
          } catch {
            // Card building must never break the tool result.
          }
          const payload = card ? { ...device, _card: card } : device;
          return { content: [{ type: "text", text: JSON.stringify(payload ?? {}, null, 2) }] };
        }

        case "datto_bcdr_list_assets": {
          const params = (args ?? {}) as { serialNumber?: string };
          const sn = await resolveSerialNumber(client, params.serialNumber);
          if (!sn) {
            return {
              content: [{ type: "text", text: "Error: serialNumber is required." }],
              isError: true,
            };
          }
          const assets = await client.assets.list(sn);
          return { content: [{ type: "text", text: JSON.stringify(assets ?? [], null, 2) }] };
        }

        case "datto_bcdr_get_asset": {
          const { serialNumber, agentId } = args as { serialNumber: string; agentId: string };
          const asset = await client.assets.get(serialNumber, agentId);
          return { content: [{ type: "text", text: JSON.stringify(asset ?? {}, null, 2) }] };
        }

        case "datto_bcdr_list_backups": {
          const { serialNumber, agentId } = args as { serialNumber: string; agentId: string };
          const backups = await client.backups.list(serialNumber, agentId);
          return { content: [{ type: "text", text: JSON.stringify(backups ?? [], null, 2) }] };
        }

        case "datto_bcdr_list_screenshots": {
          const { serialNumber, agentId } = args as { serialNumber: string; agentId: string };
          const shots = await client.screenshots.list(serialNumber, agentId);
          return { content: [{ type: "text", text: JSON.stringify(shots ?? [], null, 2) }] };
        }

        case "datto_bcdr_get_screenshot": {
          const { serialNumber, agentId, epoch } = args as {
            serialNumber: string;
            agentId: string;
            epoch: number;
          };
          const buffer = await client.screenshots.getImage(serialNumber, agentId, epoch);
          const data: Buffer = Buffer.isBuffer(buffer)
            ? (buffer as Buffer)
            : Buffer.from(buffer as unknown as ArrayBuffer);
          return {
            content: [
              {
                type: "image",
                data: data.toString("base64"),
                mimeType: "image/png",
              },
            ],
          };
        }

        case "datto_bcdr_get_offsite_status": {
          const { serialNumber } = args as { serialNumber: string };
          const status = await client.offsite.get(serialNumber);
          return { content: [{ type: "text", text: JSON.stringify(status ?? {}, null, 2) }] };
        }

        case "datto_bcdr_list_alerts": {
          const range = await resolveDateRange((args ?? {}) as { since?: string; until?: string });
          const alerts = await collectWithDateFilter(client.alerts.listAll(), range);
          return { content: [{ type: "text", text: JSON.stringify(alerts, null, 2) }] };
        }

        case "datto_bcdr_list_activity": {
          const range = await resolveDateRange((args ?? {}) as { since?: string; until?: string });
          const activity = await collectWithDateFilter(client.activity.listAll(), range);
          return { content: [{ type: "text", text: JSON.stringify(activity, null, 2) }] };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}
