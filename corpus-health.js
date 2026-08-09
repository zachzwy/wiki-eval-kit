#!/usr/bin/env node
// @ts-check
// STAGE 0 — corpus health. Static metrics over the ingested wiki.
// No LLM calls, no cost, runs in seconds. Do this before any answer-quality eval:
// it catches the failure mode that matters (duplicate + contradictory pages)
// directly at the source, and gives you a before/after for any ingest change.
//
//   node corpus-health.js            # human report
//   node corpus-health.js --json     # machine-readable (for trend tracking)
/** Load the user's adapter, with a useful message if it isn't set up yet. */
async function loadAdapter() {
  try {
    return await import("./adapter.js");
  } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND" && /adapter\.js/.test(e.message)) {
      console.error(
        "\n  No adapter.js found.\n\n" +
        "  This kit talks to your system through one file:\n" +
        "      cp adapter.example.js adapter.js\n" +
        "  then implement listPages() (Stage 0) and ask() (Stages 2-3).\n"
      );
      process.exit(1);
    }
    throw e;
  }
}

// Similarity is Jaccard over word shingles. SHINGLE=3 because wiki pages are
// often short: at n=5 a genuinely-related pair of short pages scored 0.19 (missed),
// at n=3 the same pair scored 0.44 while unrelated pages stayed at 0.00. If your
// pages are long prose, raise it; if detection looks noisy, raise RELATED first.
const SHINGLE = 3;
const NEAR_DUP = 0.5;   // "these are the same page" — ingest should have merged them
const RELATED = 0.25;   // "same topic" — worth checking whether their values disagree

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

function shingles(text, n = SHINGLE) {
  const w = norm(text).split(" ").filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Numeric claims with their units — the thing that actually contradicts. */
function values(text) {
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|seconds?|secs?|%|percent)/gi;
  const out = new Set();
  for (const m of String(text).matchAll(re)) {
    const unit = m[2].toLowerCase().replace(/s$/, "").replace(/^(min|hr|sec)$/, (u) => ({ min: "minute", hr: "hour", sec: "second" }[u]));
    out.add(`${m[1].replace(/,/g, "")} ${unit}`);
  }
  return out;
}

const daysOld = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null);

async function main() {
  const json = process.argv.includes("--json");
  const { listPages } = await loadAdapter();
  const pages = await listPages();
  const prepped = pages.map((p) => ({ ...p, sh: shingles(p.text), vals: values(p.text) }));

  // --- pairwise comparison ---
  const dupes = [];        // near-identical pages: ingest failed to dedup
  const conflicts = [];    // related pages asserting DIFFERENT values: the killer
  for (let i = 0; i < prepped.length; i++) {
    for (let j = i + 1; j < prepped.length; j++) {
      const a = prepped[i], b = prepped[j];
      const sim = jaccard(a.sh, b.sh);
      if (sim >= NEAR_DUP) dupes.push({ a: a.id, b: b.id, sim: +sim.toFixed(2) });
      if (sim >= RELATED) {
        const onlyA = [...a.vals].filter((v) => !b.vals.has(v));
        const onlyB = [...b.vals].filter((v) => !a.vals.has(v));
        if (onlyA.length && onlyB.length)
          conflicts.push({ a: a.id, b: b.id, sim: +sim.toFixed(2), aSays: onlyA, bSays: onlyB });
      }
    }
  }

  // --- staleness ---
  const ages = pages.map((p) => daysOld(p.updatedAt)).filter((d) => d !== null).sort((x, y) => x - y);
  const pct = (q) => (ages.length ? ages[Math.min(ages.length - 1, Math.floor(ages.length * q))] : null);

  // --- orphans (navigation wikis: a page nothing links to is hard to reach) ---
  const ids = new Set(pages.map((p) => p.id));
  const linkedTo = new Set();
  for (const p of pages)
    for (const m of String(p.text).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const t = m[1].replace(/\.md$/, "").replace(/^\.?\//, "");
      if (ids.has(t)) linkedTo.add(t);
    }
  const orphans = pages.filter((p) => !linkedTo.has(p.id)).map((p) => p.id);

  const report = {
    pages: pages.length,
    duplicatePairs: dupes.length,
    conflictPairs: conflicts.length,
    orphanPages: orphans.length,
    staleness: { medianDays: pct(0.5), p90Days: pct(0.9), oldestDays: ages.at(-1) ?? null, withoutDate: pages.length - ages.length },
    details: { dupes: dupes.slice(0, 20), conflicts: conflicts.slice(0, 20), orphans: orphans.slice(0, 20) },
  };

  if (json) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log(`\ncorpus health — ${report.pages} pages\n${"=".repeat(46)}`);
  console.log(`  duplicate pairs : ${report.duplicatePairs}   (ingest should have merged these)`);
  console.log(`  CONFLICT pairs  : ${report.conflictPairs}   ← related pages asserting different values`);
  console.log(`  orphan pages    : ${report.orphanPages}   (nothing links here)`);
  console.log(`  staleness       : median ${report.staleness.medianDays}d · p90 ${report.staleness.p90Days}d · oldest ${report.staleness.oldestDays}d · ${report.staleness.withoutDate} undated`);

  if (conflicts.length) {
    console.log(`\n  conflicts (the ones that destroy clean answers):`);
    for (const c of report.details.conflicts)
      console.log(`    ${c.a}  vs  ${c.b}   (sim ${c.sim})\n       "${c.aSays.join(", ")}"  vs  "${c.bSays.join(", ")}"`);
  }
  if (dupes.length) {
    console.log(`\n  near-duplicates:`);
    for (const d of report.details.dupes) console.log(`    ${d.a}  ≈  ${d.b}   (sim ${d.sim})`);
  }
  console.log(`\n  → conflictPairs is the number to drive to zero. Re-run after any ingest change.\n`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
