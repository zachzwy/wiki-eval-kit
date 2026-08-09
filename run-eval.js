#!/usr/bin/env node
// @ts-check
// STAGES 2–3 — answer quality, measured as CLEAN-ANSWER RATE.
//
//   node run-eval.js                                   # 1 run per question
//   node run-eval.js --runs 3                          # 3 runs => a rate, not a coin flip
//   node run-eval.js --conditions reconcile-on,reconcile-off   # A/B an ingest change
//   node run-eval.js --questions ./questions.json --json > out.json
//
// The metric: an answer passes only if every `expect` matches AND no `reject`
// matches. The reject list is the whole point — "does the right value appear?"
// scores a hedge ("the sources say 45 or 30") as a pass and will report 100%
// while quality collapses. Ask for a CLEAN answer, not a correct substring.
//
// Two rules carried over from prior measurement:
//   1. Run N times and report a rate. These systems are stochastic; one run is noise.
//   2. Freeze the source snapshot before a comparison, or the corpus shifts
//      underneath you and the A/B is meaningless.
import { readFile } from "node:fs/promises";
import * as adapter from "./adapter.js";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.split("=").slice(1).join("=") : dflt;
};

// Phrasings that count as honestly admitting a gap. Deliberately broad: a
// too-narrow matcher here reports fabrication when the system behaved correctly.
// (The first version missed "could not find" — it only matched "couldn't".)
const UNKNOWN = new RegExp(
  [
    // "cannot / could not / unable to ... find|determine|..."
    "\\b(cannot|can\\s?not|can'?t|could\\s?not|couldn'?t|unable|not able|do\\s?not|don'?t|no)\\b[^.]{0,60}\\b(find|determine|locate|answer|know|say|see|tell|contain|available|documented|mention|specif)\\w*",
    // "not in the wiki / not documented / not covered"
    "\\bnot\\s+(in|found|covered|documented|mentioned|specified|available|present)\\b",
    // "no information / nothing in the sources"
    "\\b(no|nothing)\\s+(information|mention|record|documentation|reference|detail|data)\\b",
    // "doesn't contain / does not mention"
    "\\bdoes\\s?n'?o?t\\s+(contain|mention|cover|specify|include|document)\\b",
    // "I don't have ..." / "isn't documented"
    "\\b(is|was)\\s?n'?o?t\\s+(documented|specified|mentioned|covered|available)\\b",
  ].join("|"),
  "i",
);

/** Grade one answer. Returns {pass, why}. */
async function grade(q, answer) {
  const text = String(answer ?? "");

  if (q.mustSayUnknown) {
    return UNKNOWN.test(text)
      ? { pass: true, why: "admitted it could not find the answer" }
      : { pass: false, why: "did NOT admit the gap (possible fabrication)" };
  }

  for (const p of q.expect ?? []) {
    if (!new RegExp(p, "i").test(text)) return { pass: false, why: `missing expected /${p}/` };
  }
  for (const p of q.reject ?? []) {
    if (new RegExp(p, "i").test(text)) return { pass: false, why: `surfaced rejected /${p}/ — stale value or hedge` };
  }
  if (q.rubric) {
    const ok = await adapter.judge({ question: q.question, answer: text, rubric: q.rubric });
    if (!ok) return { pass: false, why: "failed rubric (judge)" };
  }
  return { pass: true, why: "clean answer" };
}

async function main() {
  const runs = Number(arg("runs", "1"));
  const conditions = String(arg("conditions", "default")).split(",").filter(Boolean);
  const asJson = process.argv.includes("--json");
  const questions = JSON.parse(await readFile(arg("questions", "./questions.json"), "utf8"));

  const rows = [];
  for (const q of questions) {
    const cells = {};
    for (const condition of conditions) {
      let pass = 0;
      const whys = [];
      for (let i = 0; i < runs; i++) {
        let answer = "", err = null;
        try { answer = await adapter.ask(q.question, { condition }); }
        catch (e) { err = e.message; }
        const g = err ? { pass: false, why: `error: ${err}` } : await grade(q, answer);
        if (g.pass) pass++; else whys.push(g.why);
      }
      cells[condition] = { pass, runs, whys: [...new Set(whys)] };
    }
    rows.push({ id: q.id, cells });
    if (!asJson) {
      const summary = conditions.map((c) => `${c} ${cells[c].pass}/${runs}`).join("   ");
      console.log(`  ${String(q.id).padEnd(24)} ${summary}`);
      for (const c of conditions)
        for (const w of cells[c].whys) console.log(`      ↳ ${c}: ${w}`);
    }
  }

  const totals = {};
  for (const c of conditions) {
    const p = rows.reduce((s, r) => s + r.cells[c].pass, 0);
    const n = rows.length * runs;
    totals[c] = { pass: p, n, rate: n ? Math.round((p / n) * 100) : 0 };
  }
  const out = { date: new Date().toISOString(), runs, questions: questions.length, totals, rows };

  if (asJson) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log(`\n${"=".repeat(52)}\nclean-answer rate · ${questions.length} questions × ${runs} run(s)`);
  for (const c of conditions) console.log(`  ${c.padEnd(20)} ${totals[c].pass}/${totals[c].n}   ${totals[c].rate}%`);
  if (conditions.length === 2) {
    const [a, b] = conditions;
    console.log(`\n  delta ${a} → ${b}: ${totals[b].rate - totals[a].rate} pts`);
  }
  console.log();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
