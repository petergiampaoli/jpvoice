import { writeFileSync } from "node:fs";
import { analyze } from "../metrics/stylometry.js";
import { countWords } from "../util/text.js";
import type { Project } from "../store/project.js";
import { readScene, reportPath } from "../store/project.js";
import { characterNames } from "../pipeline/polisher.js";
import { scoreText } from "../pipeline/score.js";
import type { EffectiveVoice } from "../voice/schema.js";

export type AuditResult = {
  scenes: Array<{
    id: string;
    chapter: number;
    score: number;
    pass: boolean;
    words: number;
    target: number;
    issues: number;
  }>;
  curve: Array<{ chapter: number; meanScore: number; words: number; target: number }>;
  drift: {
    scoreDrop: number;
    meanSentenceWords: number;
    nameToPronounRatio: number;
    hedgePer1k: number;
  };
  breakers: Array<{ phrase: string; count: number; scenes: string[] }>;
  ticOverruns: Array<{ phrase: string; worst: number; scenes: string[] }>;
  continuity: {
    absentEntities: string[];
    unansweredThreads: string[];
    thinScenes: string[];
    emptyScenes: string[];
  };
  totals: { words: number; target: number; scenes: number; drafted: number };
  pass: boolean;
};

export function auditProject(args: {
  workDir: string;
  project: Project;
  voice: EffectiveVoice;
}): AuditResult {
  const { workDir, project, voice } = args;
  const names = characterNames(project);

  const scenes: AuditResult["scenes"] = [];
  const breakerMap = new Map<string, { count: number; scenes: Set<string> }>();
  const ticMap = new Map<string, { worst: number; scenes: Set<string> }>();
  const chapterBuckets = new Map<number, { scores: number[]; words: number; target: number }>();
  const firstChapterTexts: string[] = [];
  const lastChapterTexts: string[] = [];
  const allText: string[] = [];

  const ordered = Object.values(project.scenes).sort((a, b) => a.id.localeCompare(b.id));
  const maxChapter = Math.max(...ordered.map((s) => s.chapter), 1);

  for (const scene of ordered) {
    const body = readScene(workDir, scene.id);
    const words = body ? countWords(body) : 0;
    if (!body || words === 0) {
      scenes.push({
        id: scene.id,
        chapter: scene.chapter,
        score: 0,
        pass: false,
        words: 0,
        target: scene.targetWords,
        issues: 0,
      });
      continue;
    }

    allText.push(body);
    if (scene.chapter === 1) firstChapterTexts.push(body);
    if (scene.chapter === maxChapter) lastChapterTexts.push(body);

    const { report } = scoreText(body, voice, names);
    scenes.push({
      id: scene.id,
      chapter: scene.chapter,
      score: report.score,
      pass: report.pass,
      words,
      target: scene.targetWords,
      issues: report.issues.length,
    });

    for (const issue of report.issues) {
      if (issue.metric === "breaker") {
        const key = issue.label;
        const cur = breakerMap.get(key) ?? { count: 0, scenes: new Set<string>() };
        cur.count += Number(issue.value);
        cur.scenes.add(scene.id);
        breakerMap.set(key, cur);
      }
    }

    const m = analyze(body, { names, ticPhrases: voice.tics.map((t) => t.phrase) });
    for (const tic of voice.tics) {
      const rate = m.tics[tic.phrase] ?? 0;
      if (rate > tic.per1kMax) {
        const cur = ticMap.get(tic.phrase) ?? { worst: 0, scenes: new Set<string>() };
        cur.worst = Math.max(cur.worst, rate);
        cur.scenes.add(scene.id);
        ticMap.set(tic.phrase, cur);
      }
    }

    const bucket = chapterBuckets.get(scene.chapter) ?? { scores: [], words: 0, target: 0 };
    bucket.scores.push(report.score);
    bucket.words += words;
    bucket.target += scene.targetWords;
    chapterBuckets.set(scene.chapter, bucket);
  }

  const curve = [...chapterBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([chapter, b]) => ({
      chapter,
      meanScore: Math.round(b.scores.reduce((x, y) => x + y, 0) / Math.max(1, b.scores.length)),
      words: b.words,
      target: b.target,
    }));

  const firstText = firstChapterTexts.join("\n\n");
  const lastText = lastChapterTexts.join("\n\n");
  const firstM = analyze(firstText, { names });
  const lastM = analyze(lastText, { names });

  const drift = {
    scoreDrop: curve.length >= 2 ? (curve[0]!.meanScore - curve[curve.length - 1]!.meanScore) : 0,
    meanSentenceWords: Number((lastM.meanSentenceWords - firstM.meanSentenceWords).toFixed(2)),
    nameToPronounRatio: Number((lastM.nameToPronounRatio - firstM.nameToPronounRatio).toFixed(2)),
    hedgePer1k: Number((lastM.hedgePer1k - firstM.hedgePer1k).toFixed(2)),
  };

  const absentEntities: string[] = [];
  const haystack = allText.join("\n");
  for (const e of project.bible.entities) {
    if (!new RegExp(`\\b${escapeRegex(e.name)}\\b`).test(haystack)) absentEntities.push(e.name);
  }

  const unansweredThreads = project.bible.threads.filter((t) => {
    const keywords = t.toLowerCase().match(/[a-z]{5,}/g) ?? [];
    if (keywords.length === 0) return false;
    const hits = keywords.filter((k) => haystack.toLowerCase().includes(k)).length;
    return hits < Math.ceil(keywords.length / 2);
  });

  const thinScenes = scenes.filter((s) => s.words > 0 && s.words < s.target * 0.6).map((s) => s.id);
  const emptyScenes = scenes.filter((s) => s.words === 0).map((s) => s.id);

  const totals = {
    words: scenes.reduce((s, x) => s + x.words, 0),
    target: scenes.reduce((s, x) => s + x.target, 0),
    scenes: scenes.length,
    drafted: scenes.filter((s) => s.words > 0).length,
  };

  const pass =
    emptyScenes.length === 0 &&
    breakersToArray(breakerMap).length === 0 &&
    Math.abs(totals.words - totals.target) / Math.max(1, totals.target) < 0.1 &&
    scenes.filter((s) => !s.pass && s.words > 0).length <= Math.ceil(scenes.length * 0.34);

  return {
    scenes,
    curve,
    drift,
    breakers: breakersToArray(breakerMap),
    ticOverruns: [...ticMap.entries()]
      .map(([phrase, v]) => ({ phrase, worst: Number(v.worst.toFixed(2)), scenes: [...v.scenes] }))
      .sort((a, b) => b.worst - a.worst),
    continuity: { absentEntities, unansweredThreads, thinScenes, emptyScenes },
    totals,
    pass,
  };
}

function breakersToArray(map: Map<string, { count: number; scenes: Set<string> }>) {
  return [...map.entries()]
    .map(([phrase, v]) => ({ phrase, count: v.count, scenes: [...v.scenes] }))
    .sort((a, b) => b.count - a.count);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function renderAuditMarkdown(audit: AuditResult, project: Project): string {
  const lines: string[] = [];
  lines.push(`# Audit — ${project.meta.title}`);
  lines.push("");
  lines.push(`Voice: ${project.meta.voiceKey} · form: ${project.meta.form}`);
  lines.push(`Words: ${audit.totals.words.toLocaleString()} / ${audit.totals.target.toLocaleString()} target`);
  lines.push(`Scenes drafted: ${audit.totals.drafted} / ${audit.totals.scenes}`);
  lines.push(`Verdict: ${audit.pass ? "PASS" : "NEEDS WORK"}`);
  lines.push("");

  lines.push(`## Drift curve`);
  lines.push("");
  lines.push(`| Chapter | Mean score | Words | Target |`);
  lines.push(`|---|---|---|---|`);
  for (const c of audit.curve) {
    lines.push(`| ${c.chapter} | ${c.meanScore} | ${c.words} | ${c.target} |`);
  }
  lines.push("");
  lines.push(`Change from first to last chapter:`);
  lines.push(`- score drop: ${audit.drift.scoreDrop}`);
  lines.push(`- mean sentence length: ${signed(audit.drift.meanSentenceWords)}`);
  lines.push(`- names per pronoun: ${signed(audit.drift.nameToPronounRatio)}`);
  lines.push(`- hedges per 1k: ${signed(audit.drift.hedgePer1k)}`);
  lines.push("");

  if (audit.breakers.length) {
    lines.push(`## Register breakers`);
    for (const b of audit.breakers) lines.push(`- ${b.phrase} ×${b.count} — ${b.scenes.join(", ")}`);
    lines.push("");
  }

  if (audit.ticOverruns.length) {
    lines.push(`## Tic overruns`);
    for (const t of audit.ticOverruns) lines.push(`- "${t.phrase}" peak ${t.worst}/1k — ${t.scenes.join(", ")}`);
    lines.push("");
  }

  lines.push(`## Continuity`);
  if (audit.continuity.emptyScenes.length) lines.push(`- undrafted: ${audit.continuity.emptyScenes.join(", ")}`);
  if (audit.continuity.thinScenes.length) lines.push(`- under 60% of target: ${audit.continuity.thinScenes.join(", ")}`);
  if (audit.continuity.absentEntities.length) lines.push(`- never appear: ${audit.continuity.absentEntities.join(", ")}`);
  if (audit.continuity.unansweredThreads.length) {
    for (const t of audit.continuity.unansweredThreads) lines.push(`- thread without payoff: ${t}`);
  }
  lines.push("");

  lines.push(`## Weakest scenes`);
  const weak = audit.scenes
    .filter((s) => s.words > 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 8);
  for (const s of weak) lines.push(`- ${s.id}: score ${s.score}, ${s.issues} issues, ${s.words}/${s.target} words`);
  lines.push("");

  return lines.join("\n");
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function writeAudit(args: { workDir: string; project: Project; audit: AuditResult }): string {
  const md = renderAuditMarkdown(args.audit, args.project);
  const stamp = new Date().toISOString().slice(0, 10);
  const path = reportPath(args.workDir, `audit-${stamp}-${Date.now().toString(36)}`);
  writeFileSync(path, md, "utf8");
  return path;
}

export function syncSceneWordCounts(workDir: string, project: Project): void {
  for (const scene of Object.values(project.scenes)) {
    const body = readScene(workDir, scene.id);
    if (!body) continue;
    scene.words = countWords(body);
    if (scene.words > 0 && scene.status === "pending") scene.status = "drafted";
  }
}
