#!/usr/bin/env node
// @ts-check
// STAGE 0 (conceptual corpus) — epistemic health.
//
//   node epistemic-health.js [--root <wiki-dir>] [--json]
//
// The companion to corpus-health.js. That one is for OPERATIONAL corpora, where a
// contradiction is two pages asserting different values ("45 minutes" vs "30
// minutes"). This one is for CONCEPTUAL corpora, where pages argue rather than
// specify — there are no numeric claims to compare, so health means something else:
// is every claim sourced, are contradictions being recorded and retired, is
// anything human-verified.
//
// This does NOT replace an agent's semantic lint pass, which judges whether a
// specific claim is weak. It COUNTS what that pass judges, so the qualitative
// findings become a trend you can watch as the corpus grows. Decay in a wiki like
// this is gradual — a slowly rising unsourced ratio, a tension pile that only ever
// grows — and gradual decay is invisible without a number.
//
// Format assumptions (OKF / markdown-with-footnotes; adjust if yours differ):
//   frontmatter    --- YAML --- at the top
//   citations      [^id] inline, [^id]: definition
//   contradictions a "## Tensions" section, entries as "- **Question?** ..."
//   verification   a `verified:` key in frontmatter
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const argOf = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const ROOT = path.resolve(argOf("root", process.env.WIKI_ROOT ?? "."));
const PAGE_DIRS = ["concepts", "techniques", "tools", "people", "questions", "notes", "evals"];

const split = (md) => {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : { fm: "", body: md };
};

/** Body paragraphs that make assertions: prose only, no headings/code/quotes/footnote defs. */
function prose(body) {
  const noCode = body.replace(/```[\s\S]*?```/g, "");
  return noCode
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) =>
      p &&
      !p.startsWith("#") &&
      !p.startsWith(">") &&
      !p.startsWith("|") &&
      !/^\[\^[^\]]+\]:/.test(p) &&     // footnote definition
      !/^(\*|-|\d+\.)\s/.test(p) &&    // list block
      p.split(/\s+/).length >= 12,     // ignore fragments/captions
    );
}

async function main() {
  const asJson = process.argv.includes("--json");
  const pages = [];
  for (const dir of PAGE_DIRS) {
    let entries = [];
    try { entries = await readdir(path.join(ROOT, dir), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const raw = await readFile(path.join(ROOT, dir, e.name), "utf8");
      const { fm, body } = split(raw);
      pages.push({ id: `${dir}/${e.name.replace(/\.md$/, "")}`, fm, body });
    }
  }

  const ids = new Set(pages.map((p) => p.id));
  const report = { root: ROOT, date: new Date().toISOString(), pages: pages.length };

  // --- provenance -----------------------------------------------------------
  let sourced = 0, unsourcedPages = [], proseTotal = 0, proseCited = 0, thinPages = [];
  for (const p of pages) {
    const declares = /^sources:/m.test(p.fm);
    if (declares) sourced++; else unsourcedPages.push(p.id);
    const paras = prose(p.body);
    const cited = paras.filter((x) => /\[\^[^\]]+\]/.test(x));
    proseTotal += paras.length; proseCited += cited.length;
    // a page that declares sources but rarely cites them in the body
    if (declares && paras.length >= 4 && cited.length / paras.length < 0.34)
      thinPages.push({ id: p.id, cited: cited.length, paras: paras.length });
  }
  report.provenance = {
    pagesDeclaringSources: sourced,
    pagesWithoutSources: unsourcedPages.length,
    proseParagraphs: proseTotal,
    citedParagraphs: proseCited,
    citedRatio: proseTotal ? +(proseCited / proseTotal).toFixed(2) : null,
    thinlyCitedPages: thinPages,
    unsourced: unsourcedPages,
  };

  // --- tensions (the decay mode) -------------------------------------------
  let entries = 0, resolved = 0, pagesWith = 0;
  const tensionDetail = [];
  for (const p of pages) {
    // NB: JS has no \Z. Slice to the next "## " heading instead of trying to
    // express "or end of input" in a lookahead — an earlier version used \Z,
    // which matches a literal "Z", so this silently found nothing.
    const start = p.body.search(/^##\s+Tensions/m);
    if (start === -1) continue;
    const after = p.body.slice(start);
    const nextH = after.slice(1).search(/^##\s/m);
    const secText = nextH === -1 ? after : after.slice(0, nextH + 1);
    pagesWith++;
    // entries open with a bolded question bullet
    const items = secText.split(/\n(?=[-*]\s+\*\*)/).filter((s) => /^[-*]\s+\*\*/.test(s.trim()));
    for (const it of items) {
      entries++;
      const isResolved = /\b(resolved|settled|superseded|closed)\b/i.test(it) && !/\bunresolved\b/i.test(it);
      if (isResolved) resolved++;
      tensionDetail.push({ page: p.id, resolved: isResolved, q: (it.match(/\*\*(.+?)\*\*/)?.[1] ?? "").slice(0, 72) });
    }
  }
  report.tensions = { pagesWithTensions: pagesWith, entries, resolved, unresolved: entries - resolved, detail: tensionDetail };

  // --- verification ---------------------------------------------------------
  const verified = pages.filter((p) => /^verified:/m.test(p.fm)).map((p) => p.id);
  report.verification = { verified: verified.length, coverage: pages.length ? +(verified.length / pages.length).toFixed(2) : 0, pages: verified };

  // --- links ----------------------------------------------------------------
  let internal = 0; const broken = [];
  for (const p of pages)
    for (const m of p.body.matchAll(/\[[^\]]*\]\((\/[^)\s#]+)\)/g)) {
      const t = m[1].replace(/^\//, "").replace(/\.md$/, "");
      if (t.startsWith("raw/") || t === "CLAUDE" || t === "index" || t === "log" || t.startsWith("reflection/")) continue;
      internal++;
      if (!ids.has(t)) broken.push({ from: p.id, to: m[1] });
    }
  report.links = { internal, broken: broken.length, detail: broken.slice(0, 20) };

  if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }

  const pc = (n) => `${Math.round(n * 100)}%`;
  console.log(`\nepistemic health — ${report.pages} pages · ${path.basename(ROOT)}\n${"=".repeat(52)}`);
  console.log(`  PROVENANCE`);
  console.log(`    pages declaring sources : ${sourced}/${pages.length}${unsourcedPages.length ? `   (${unsourcedPages.length} without)` : ""}`);
  console.log(`    prose paragraphs cited  : ${proseCited}/${proseTotal}  ${report.provenance.citedRatio !== null ? pc(report.provenance.citedRatio) : ""}   ← watch this trend`);
  if (thinPages.length) {
    console.log(`    thinly cited pages      : ${thinPages.length}`);
    for (const t of thinPages.slice(0, 6)) console.log(`        ${t.id}  (${t.cited}/${t.paras} paragraphs)`);
  }
  if (unsourcedPages.length) console.log(`    no sources declared     : ${unsourcedPages.slice(0, 6).join(", ")}`);

  console.log(`\n  CONTRADICTIONS (the decay mode)`);
  console.log(`    tension entries         : ${entries} across ${pagesWith} pages`);
  console.log(`    resolved / unresolved   : ${resolved} / ${entries - resolved}   ← if unresolved only ever grows, the wiki is accumulating doubt rather than settling it`);
  for (const t of tensionDetail.slice(0, 6)) console.log(`        [${t.resolved ? "resolved" : "  open  "}] ${t.page}: ${t.q}`);

  console.log(`\n  VERIFICATION`);
  console.log(`    human-verified          : ${verified.length}/${pages.length}  ${pc(report.verification.coverage)}`);

  console.log(`\n  LINKS`);
  console.log(`    internal / broken       : ${internal} / ${broken.length}   (broken = pages worth writing, per this vault's convention)`);
  for (const b of broken.slice(0, 6)) console.log(`        ${b.from} → ${b.to}`);
  console.log(`\n  Append --json to a history file and watch citedRatio and unresolved tensions over time.\n`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
