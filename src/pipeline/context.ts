import type { Project, SceneState } from "../store/project.js";
import { readScene, orderedScenes } from "../store/project.js";

export type ContextBundle = {
  anchors: string[];
  bible: string;
  previous: string;
  characters: string;
};

function tail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(text.length - maxChars);
  const idx = slice.indexOf(" ");
  return (idx > 0 ? slice.slice(idx + 1) : slice).trim();
}

function pickAnchors(anchors: string[], sceneId: string): string[] {
  if (anchors.length === 0) return [];
  if (anchors.length <= 2) return anchors;
  const seed = sceneId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const a = anchors[seed % anchors.length]!;
  const b = anchors[(seed + 1) % anchors.length]!;
  return a === b ? [a] : [a, b];
}

export function buildContext(args: {
  workDir: string;
  project: Project;
  scene: SceneState;
  anchorTexts: string[];
}): ContextBundle {
  const { workDir, project, scene, anchorTexts } = args;

  const all = orderedScenes(project);
  const idx = all.findIndex((s) => s.id === scene.id);
  const prev = idx > 0 ? all[idx - 1]! : null;
  const prevText = prev ? readScene(workDir, prev.id) ?? "" : "";

  const names = new Set<string>();
  for (const c of project.plan?.characters ?? []) names.add(c.name);
  for (const e of project.bible.entities) names.add(e.name);
  for (const n of names) {
    if (scene.beat.includes(n)) names.add(n);
  }

  const entityLines: string[] = [];
  for (const e of project.bible.entities) {
    if (!names.has(e.name)) continue;
    entityLines.push(`- ${e.name} (${e.role}): ${e.note}`);
  }
  const facts = project.bible.facts.slice(-14);
  const threads = project.bible.threads.slice(-8);
  const events = project.bible.events.slice(-10);

  const bibleParts: string[] = [];
  if (entityLines.length) bibleParts.push(`People and things:\n${entityLines.join("\n")}`);
  if (facts.length) bibleParts.push(`Established facts:\n${facts.map((f) => `- ${f}`).join("\n")}`);
  if (events.length) bibleParts.push(`What has already happened:\n${events.map((e) => `- ${e}`).join("\n")}`);
  if (threads.length) bibleParts.push(`Open threads:\n${threads.map((t) => `- ${t}`).join("\n")}`);

  const characterLines = (project.plan?.characters ?? []).map(
    (c) => `- ${c.name} — ${c.role}. ${c.note}`,
  );

  return {
    anchors: pickAnchors(anchorTexts, scene.id),
    bible: bibleParts.join("\n\n"),
    previous: tail(prevText, 1400),
    characters: characterLines.join("\n"),
  };
}
