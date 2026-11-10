import { chat } from "../llm/client.js";
import { cleanProse, scoreText } from "./score.js";
import { countWords } from "../util/text.js";
import type { Project } from "../store/project.js";
import { readScene, saveProject, writeScene } from "../store/project.js";
import { critiquePrompt } from "../critic/conformance.js";
import type { ConformanceReport } from "../critic/conformance.js";
import type { EffectiveVoice } from "../voice/schema.js";
import { renderVoiceSpec } from "../voice/render.js";

export function characterNames(project: Project): string[] {
  const names = new Set<string>();
  for (const c of project.plan?.characters ?? []) names.add(c.name);
  for (const e of project.bible.entities) names.add(e.name);
  for (const s of Object.values(project.scenes)) {
    for (const n of names) {
      if (s.beat.includes(n)) names.add(n);
    }
  }
  return [...names];
}

const POLISH_SYSTEM = `You are a line editor working on a single scene. Your job is not to make the prose better in general. Your job is to move it into a measured register, fixing only the listed problems.

You never add events, characters, information, or imagery that is not already present. You delete more than you add. You preserve every line of dialogue and every fact.

# VOICE CONTRACT
`;

export async function polishScene(args: {
  workDir: string;
  project: Project;
  voice: EffectiveVoice;
  sceneId: string;
  iterations?: number;
  silent?: boolean;
}): Promise<{ before: ConformanceReport; after: ConformanceReport; changed: boolean }> {
  const { workDir, project, voice, sceneId } = args;
  const scene = project.scenes[sceneId];
  if (!scene) throw new Error(`Unknown scene: ${sceneId}`);

  let body = readScene(workDir, sceneId);
  if (!body) throw new Error(`Scene ${sceneId} has not been drafted.`);

  const names = characterNames(project);
  const firstScore = scoreText(body, voice, names).report;
  let bestBody = body;
  let bestReport = firstScore;
  const rounds = args.iterations ?? 2;
  let changed = false;

  for (let i = 0; i < rounds; i++) {
    if (bestReport.pass || bestReport.issues.length === 0) break;

    const critique = critiquePrompt(bestReport);
    const res = await chat({
      messages: [
        { role: "system", content: POLISH_SYSTEM + renderVoiceSpec(voice) },
        {
          role: "user",
          content: [
            critique,
            ``,
            `# DRAFT`,
            bestBody,
          ].join("\n"),
        },
      ],
      tier: "pro",
      temperature: 0.35,
      tag: "polish",
    });

    const revised = cleanProse(res.text);
    if (!revised || revised.length < 50) continue;

    const revisedWords = countWords(revised);
    if (Math.abs(revisedWords - scene.targetWords) / scene.targetWords > 0.35) {
      // A revision that guts or inflates the scene is a failed revision.
      continue;
    }

    const revisedReport = scoreText(revised, voice, names).report;
    if (revisedReport.score >= bestReport.score) {
      bestBody = revised;
      bestReport = revisedReport;
      changed = true;
    }
  }

  if (changed) {
    writeScene(workDir, sceneId, bestBody);
    scene.words = countWords(bestBody);
    scene.status = "polished";
    scene.passes = (scene.passes ?? 0) + 1;
    scene.score = bestReport.score;
    scene.updatedAt = new Date().toISOString();
    saveProject(workDir, project);
  }

  return { before: firstScore, after: bestReport, changed };
}

export async function polishAll(args: {
  workDir: string;
  project: Project;
  voice: EffectiveVoice;
  from?: string;
  to?: string;
  iterations?: number;
}): Promise<Array<{ id: string; score: number; pass: boolean; changed: boolean }>> {
  const ids = Object.values(args.project.scenes)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => s.id)
    .filter((id) => (args.from ? id >= args.from : true))
    .filter((id) => (args.to ? id <= args.to : true));

  const out: Array<{ id: string; score: number; pass: boolean; changed: boolean }> = [];
  for (const id of ids) {
    const body = readScene(args.workDir, id);
    if (!body) continue;
    const r = await polishScene({
      workDir: args.workDir,
      project: args.project,
      voice: args.voice,
      sceneId: id,
      iterations: args.iterations,
    });
    out.push({ id, score: r.after.score, pass: r.after.pass, changed: r.changed });
  }
  return out;
}
