#!/usr/bin/env node
// @ts-check
// PRE-FLIGHT — run this BEFORE trusting any health number.
//
//   node validity-check.js
//
// Answers one question: can these detectors fire on this corpus at all?
//
// A metric that reports zero problems is a hypothesis, not a result. Three times
// in this project a detector reported "nothing here" while being inapplicable or
// broken — a numeric conflict detector on a corpus with no numbers, a regex that
// silently matched nothing, a grader whose leniency hid a total collapse. This
// script checks the preconditions so a zero means "healthy" rather than "blind".
import { listPages } from "./adapter.js";

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const shingles = (t, n) => {
  const w = norm(t).split(" ").filter(Boolean);
  const o = new Set();
  for (let i = 0; i + n <= w.length; i++) o.add(w.slice(i, i + n).join(" "));
  return o;
};
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let i = 0; for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
};
const NUMERIC = /(\d[\d,]*(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|seconds?|secs?|%|percent)/gi;

async function main() {
  const pages = await listPages();
  const n = pages.length;
  console.log(`\npre-flight — ${n} pages\n${"=".repeat(56)}`);
  if (!n) { console.log("  no pages returned — fix listPages() first."); return; }

  // --- 1. size ------------------------------------------------------------
  const lens = pages.map((p) => String(p.text ?? "").length).sort((a, b) => a - b);
  const med = lens[Math.floor(n / 2)];
  const empty = lens.filter((l) => l < 50).length;
  console.log(`\n1. PAGE SIZE`);
  console.log(`   median ${med} chars · min ${lens[0]} · max ${lens.at(-1)}`);
  if (empty) console.log(`   ⚠ ${empty} pages under 50 chars — extraction may be failing (check before blaming ingest)`);
  console.log(`   → shingle size: ${med < 800 ? "3 is right for short pages" : "consider SHINGLE=4-5 for long prose"}`);

  // --- 2. can the DUPLICATE / CONFLICT detector fire? ---------------------
  const est = (n * (n - 1)) / 2;
  console.log(`\n2. SIMILARITY (${est.toLocaleString()} pairs)`);
  if (est > 5e7) {
    console.log(`   ⚠ too many pairs to compare naively — block by title token or category first`);
  } else {
    const P = pages.map((p) => ({ id: p.id, sh: shingles(p.text ?? "", 3) }));
    const top = [];
    for (let i = 0; i < P.length; i++)
      for (let j = i + 1; j < P.length; j++) top.push({ a: P[i].id, b: P[j].id, s: jaccard(P[i].sh, P[j].sh) });
    top.sort((x, y) => y.s - x.s);
    console.log(`   max similarity ${top[0].s.toFixed(3)}   (RELATED=0.25, NEAR_DUP=0.5)`);
    top.slice(0, 3).forEach((t) => console.log(`     ${t.s.toFixed(3)}  ${t.a}  ~  ${t.b}`));
    if (top[0].s < 0.25)
      console.log(`   → NOTHING clears the RELATED bar. A 0 from corpus-health means "no similar pages",\n     which is a real finding — but conflicts CANNOT be detected either way.`);
  }

  // --- 3. can the CONFLICT detector fire? (needs numeric claims) ----------
  const withNums = pages.filter((p) => (String(p.text ?? "").match(NUMERIC) || []).length);
  console.log(`\n3. NUMERIC CLAIMS  (conflict detection depends on these)`);
  console.log(`   ${withNums.length}/${n} pages contain an extractable "<number> <unit>" claim`);
  if (!withNums.length) {
    console.log(`   ✗ conflict detection is INAPPLICABLE to this corpus.`);
    console.log(`     A 0 from corpus-health means "cannot see", not "healthy".`);
    console.log(`     → use epistemic-health.js instead (conceptual corpus).`);
  } else {
    console.log(`   ✓ conflict detection can fire. → corpus-health.js applies.`);
    withNums.slice(0, 3).forEach((p) => console.log(`     ${p.id}: ${(String(p.text).match(NUMERIC) || []).slice(0, 3).join(" | ")}`));
  }

  // --- 4. metadata completeness ------------------------------------------
  const dated = pages.filter((p) => p.updatedAt).length;
  console.log(`\n4. METADATA`);
  console.log(`   ${dated}/${n} pages have updatedAt  ${dated === 0 ? "✗ staleness metrics will be empty" : dated < n ? "⚠ partial" : "✓"}`);

  // --- 5. links -----------------------------------------------------------
  const ids = new Set(pages.map((p) => p.id));
  let links = 0, resolved = 0;
  for (const p of pages)
    for (const m of String(p.text ?? "").matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      links++;
      const t = m[1].replace(/\.md$/, "").replace(/^\.?\//, "");
      if (ids.has(t)) resolved++;
    }
  console.log(`\n5. LINKS`);
  console.log(`   ${links} markdown links, ${resolved} resolve to known page ids`);
  if (links && !resolved) console.log(`   ⚠ none resolve — id format probably doesn't match link targets; orphan counts will be meaningless`);
  if (!links) console.log(`   ⚠ no markdown links found — orphan detection is inapplicable (fine if the wiki isn't link-based)`);

  // --- verdict ------------------------------------------------------------
  console.log(`\n${"=".repeat(56)}\nVERDICT`);
  console.log(`   run: ${withNums.length ? "corpus-health.js (operational corpus)" : "epistemic-health.js (conceptual corpus)"}`);
  console.log(`   and treat any zero from a detector marked ✗ above as "blind", not "clean".\n`);
}

main().catch((e) => { console.error("\n  " + e.message + "\n"); process.exit(1); });
