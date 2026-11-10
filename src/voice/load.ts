import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  AuthorSpecSchema,
  FormSpecSchema,
  TranslatorSpecSchema,
  type AuthorSpec,
  type FormSpec,
  type PairingStatus,
  type TranslatorSpec,
} from "./schema.js";

const here = fileURLToPath(new URL(".", import.meta.url));

export function voicesDir(): string {
  if (process.env.JPVOICE_VOICES_DIR) return process.env.JPVOICE_VOICES_DIR;
  return join(here, "..", "..", "voices");
}

function readYaml(path: string): unknown {
  if (!existsSync(path)) throw new Error(`Voice file not found: ${path}`);
  return parseYaml(readFileSync(path, "utf8"));
}

export function loadAuthors(): AuthorSpec[] {
  const dir = join(voicesDir(), "authors");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => AuthorSpecSchema.parse(readYaml(join(dir, f))))
    .sort((a, b) => a.display.localeCompare(b.display));
}

export function loadTranslators(): TranslatorSpec[] {
  const dir = join(voicesDir(), "translators");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => TranslatorSpecSchema.parse(readYaml(join(dir, f))))
    .sort((a, b) => a.display.localeCompare(b.display));
}

export function loadForms(): FormSpec[] {
  const raw = readYaml(join(voicesDir(), "forms.yaml")) as { forms: Record<string, unknown> };
  return Object.entries(raw.forms).map(([id, body]) =>
    FormSpecSchema.parse({ id, ...(body as object) }),
  );
}

export function loadPairings(): Map<string, PairingStatus> {
  const path = join(voicesDir(), "pairings.yaml");
  if (!existsSync(path)) return new Map();
  const raw = readYaml(path) as { pairings?: Record<string, string> };
  const map = new Map<string, PairingStatus>();
  for (const [k, v] of Object.entries(raw.pairings ?? {})) {
    map.set(k.toLowerCase(), v === "canonical" ? "canonical" : "synthetic");
  }
  return map;
}

export function findAuthor(id: string): AuthorSpec {
  const a = loadAuthors().find((x) => x.id.toLowerCase() === id.toLowerCase());
  if (!a) throw new Error(`Unknown author "${id}". Run: jpvoice voices list`);
  return a;
}

export function findTranslator(id: string): TranslatorSpec {
  const t = loadTranslators().find((x) => x.id.toLowerCase() === id.toLowerCase());
  if (!t) throw new Error(`Unknown translator "${id}". Run: jpvoice voices list`);
  return t;
}

export function findForm(id: string): FormSpec {
  const f = loadForms().find((x) => x.id.toLowerCase() === id.toLowerCase());
  if (!f) throw new Error(`Unknown form "${id}".`);
  return f;
}

export function voiceDirHas(id: string): boolean {
  return existsSync(join(voicesDir(), "authors", `${basename(id)}.yaml`));
}
