import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type ProviderId = "opencode" | "deepseek";

export type TierPricing = { in: number; out: number };

export type Config = {
  provider: ProviderId;
  apiKey: string | undefined;
  authSource: string;
  baseUrl: string;
  models: { flash: string; pro: string };
  pricing: { flash: TierPricing; pro: TierPricing };
  effort: { flash: string; pro: string };
  polishTier: "pro" | "flash";
  peak: boolean;
  mock: boolean;
  maxTokens: number;
  userAgent: string;
};

export function loadDotEnv(dir = process.cwd()): void {
  const path = resolve(dir, ".env");
  if (!existsSync(path)) return;
  const body = readFileSync(path, "utf8");
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Paths OpenCode may store provider credentials in. */
function opencodeAuthPaths(): string[] {
  const paths: string[] = [];
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) paths.push(join(xdg, "opencode", "auth.json"));
  paths.push(join(homedir(), ".local", "share", "opencode", "auth.json"));
  paths.push(join(homedir(), "Library", "Application Support", "opencode", "auth.json"));
  return [...new Set(paths)];
}

export function readOpencodeKey(): { key: string; source: string } | null {
  if (process.env.OPENCODE_API_KEY) {
    return { key: process.env.OPENCODE_API_KEY, source: "env:OPENCODE_API_KEY" };
  }
  for (const path of opencodeAuthPaths()) {
    if (!existsSync(path)) continue;
    try {
      const auth = JSON.parse(readFileSync(path, "utf8")) as Record<string, { key?: string }>;
      const entry = auth["opencode-go"] ?? auth.opencode;
      if (entry?.key) return { key: entry.key, source: path };
    } catch {
      /* ignore malformed auth file */
    }
  }
  return null;
}

/** DeepSeek charges more during 01:00–04:00 and 06:00–10:00 UTC on weekdays. */
export function isPeak(now = new Date()): boolean {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = now.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

function pricingFor(provider: ProviderId, peak: boolean): { flash: TierPricing; pro: TierPricing } {
  if (provider === "opencode") {
    return peak
      ? { flash: { in: 0.3, out: 1.2 }, pro: { in: 1.32, out: 3.96 } }
      : { flash: { in: 0.15, out: 0.6 }, pro: { in: 0.66, out: 1.98 } };
  }
  return { flash: { in: 0.15, out: 0.6 }, pro: { in: 0.66, out: 1.98 } };
}

export function loadConfig(): Config {
  loadDotEnv();

  const mock = process.env.JPVOICE_MOCK === "1" || process.env.JPVOICE_MOCK === "true";
  const explicit = process.env.JPVOICE_PROVIDER as ProviderId | undefined;

  const opencode = readOpencodeKey();
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  let provider: ProviderId;
  if (explicit === "opencode" || explicit === "deepseek") provider = explicit;
  else if (deepseekKey && !opencode) provider = "deepseek";
  else if (opencode) provider = "opencode";
  else if (deepseekKey) provider = "deepseek";
  else provider = "opencode";

  const apiKey = provider === "opencode" ? opencode?.key : deepseekKey;
  const authSource =
    provider === "opencode"
      ? opencode?.source ?? "missing"
      : deepseekKey
        ? "env:DEEPSEEK_API_KEY"
        : "missing";

  const baseUrl =
    provider === "opencode"
      ? (process.env.OPENCODE_BASE_URL ?? "https://opencode.ai/inference/go/openai/v1").replace(/\/+$/, "")
      : (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, "");

  const defaultFlash = provider === "opencode" ? "deepseek-v4.1-flash" : "deepseek-chat";
  const defaultPro = provider === "opencode" ? "deepseek-v4-pro" : "deepseek-reasoner";

  const peak = isPeak();

  return {
    provider,
    apiKey,
    authSource,
    baseUrl,
    models: {
      flash: process.env.JPVOICE_MODEL_FLASH ?? defaultFlash,
      pro: process.env.JPVOICE_MODEL_PRO ?? defaultPro,
    },
    pricing: pricingFor(provider, peak),
    effort: {
      flash: process.env.JPVOICE_EFFORT_FLASH ?? "none",
      pro: process.env.JPVOICE_EFFORT_PRO ?? "none",
    },
    polishTier: process.env.JPVOICE_TIER_POLISH === "pro" ? "pro" : "flash",
    peak,
    mock,
    maxTokens: Number(process.env.JPVOICE_MAX_TOKENS ?? 8192),
    userAgent: process.env.JPVOICE_USER_AGENT ?? "jpvoice/0.1.0",
  };
}

export function requireKey(cfg: Config): string {
  if (cfg.mock) return "mock";
  if (!cfg.apiKey) {
    throw new Error(
      cfg.provider === "opencode"
        ? "No OpenCode key found. Sign in with `opencode auth login`, or set OPENCODE_API_KEY, or use --provider deepseek with DEEPSEEK_API_KEY. Set JPVOICE_MOCK=1 to run offline."
        : "DEEPSEEK_API_KEY is not set. Copy .env.example to .env and add your key, or set JPVOICE_MOCK=1 to run offline.",
    );
  }
  return cfg.apiKey;
}
