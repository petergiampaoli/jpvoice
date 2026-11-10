import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type Config = {
  apiKey: string | undefined;
  baseUrl: string;
  models: { flash: string; pro: string };
  pricing: { flash: { in: number; out: number }; pro: { in: number; out: number } };
  mock: boolean;
  maxTokens: number;
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

export function loadConfig(): Config {
  loadDotEnv();
  const mock = process.env.JPVOICE_MOCK === "1" || process.env.JPVOICE_MOCK === "true";
  return {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, ""),
    models: {
      flash: process.env.JPVOICE_MODEL_FLASH ?? "deepseek-v4.1-flash",
      pro: process.env.JPVOICE_MODEL_PRO ?? "deepseek-v4-pro",
    },
    pricing: {
      flash: { in: 0.15, out: 0.6 },
      pro: { in: 0.66, out: 1.98 },
    },
    mock,
    maxTokens: Number(process.env.JPVOICE_MAX_TOKENS ?? 8192),
  };
}

export function requireKey(cfg: Config): string {
  if (cfg.mock) return "mock";
  if (!cfg.apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. Copy .env.example to .env and add your key, or set JPVOICE_MOCK=1 to run offline.",
    );
  }
  return cfg.apiKey;
}
