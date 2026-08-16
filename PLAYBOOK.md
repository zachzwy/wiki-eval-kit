# Playbook — first measurement of a real wiki

A single session, ~2 hours. **Goal: one honest baseline number, written down with a
date.** Not a framework, not a dashboard — a number you can re-measure after an
ingest change.

Success looks like: *"Our wiki has N duplicate pages and M conflicting pairs as of
today"* — which is simultaneously your baseline, your justification for
reconciliation work, and the concrete artifact for a quality-ownership pitch.

---

## Step 0 · Pre-flight (5 min)

```bash
git clone https://github.com/zachzwy/wiki-eval-kit && cd wiki-eval-kit
cp adapter.example.js adapter.js
```

You need: read access to the ingested wiki (a directory, an API, or a DB), and
Node 20+. Nothing else. `adapter.js` and `questions.json` are gitignored — real
content cannot be committed by accident.

---

## Step 1 · Write `listPages()` (timebox: 30 min)

Only `listPages()`. Leave `ask()` throwing — Stage 0 doesn't need it.

```js
export async function listPages() {
  return [ { id, title, text, updatedAt } /* ... */ ];
}
```

- `id` — anything stable and unique; it must match how pages link to each other,
  or orphan detection is meaningless
- `text` — the full page body
- `updatedAt` — ISO date of the newest source behind the page. Omit if unavailable;
  staleness metrics simply go empty
- **Exclude** raw source bodies and human-authored pages if your wiki has those
  layers — including sources makes every summary look like a near-duplicate of
  its own source

**This step is plumbing, not findings** — pagination, permissions, HTML vs
markdown, missing timestamps. Budget for it and don't read anything into partial
output.

---

## Step 2 · Validity check — RUN THIS FIRST (2 min)

```bash
node validity-check.js
```

Do not skip to the health tools. This answers whether the detectors can fire on
your corpus *at all*, and tells you which tool applies. It reports page-size
distribution, maximum pairwise similarity, whether any numeric claims exist,
metadata completeness, and link resolution — then gives a verdict.

**Why this exists:** three separate times in this project a metric reported
"nothing wrong" while being blind — a numeric conflict detector on a corpus with
no numbers, a regex that silently matched nothing, a grader whose leniency hid a
100%→0% collapse. **A zero is a hypothesis until you know the detector can fire.**

Act on the verdict:

| Verdict | Do |
| --- | --- |
| numeric claims exist | `node corpus-health.js` |
| no numeric claims | `node epistemic-health.js` |
| `pairs > 5e7` | block by title token / category before comparing |
| links don't resolve | fix `id` format before trusting orphan counts |
| many pages under 50 chars | **stop** — extraction is broken; fix that first |

---

## Step 3 · Run the health pass (5 min)

```bash
node corpus-health.js        # operational corpus (policies, configs, procedures)
# or
node epistemic-health.js     # conceptual corpus (arguments, notes, research)

node corpus-health.js --json >> health.jsonl    # keep the trend
```

---

## Step 4 · Interpret

**Operational corpus** — what each number means:

| Metric | Reading |
| --- | --- |
| **conflict pairs** | The money metric. Related pages asserting different values is what turns clean answers into hedges. Drive to zero. |
| **duplicate pairs** | Ingest failed to reconcile. Directly justifies dedup work. |
| **orphans** | "Hard to reach by navigation", not an error. A worklist. |
| **staleness p90** | If the tail is old, recency ranking matters more than dedup. |

**Conceptual corpus:**

| Metric | Reading |
| --- | --- |
| **cited ratio** | Share of prose paragraphs carrying a footnote. The trend matters more than the level. |
| **unresolved tensions** | If this only ever grows, the wiki is accumulating doubt rather than settling it. |
| **verified coverage** | Usually 0% — a designed mechanism nobody runs. |

---

## Step 5 · Write the baseline down (10 min)

Fill this in and commit it somewhere durable. The date is the point.

```
BASELINE — <wiki name> — <YYYY-MM-DD>
pages:            
duplicate pairs:  
conflict pairs:   
orphans:          
staleness p90:    
tool + thresholds: corpus-health.js, SHINGLE=3, RELATED=0.25, NEAR_DUP=0.5
validity check:   <which detectors could fire>
known limits:     <what this does NOT measure>
```

Record thresholds — a number without them isn't comparable to next month's.

---

## Traps, and what to do

| Trap | Fix |
| --- | --- |
| **All zeros** | Re-read the validity check. Blind ≠ clean. |
| **Too many false duplicates** (long prose) | Raise `RELATED` first, then `SHINGLE` to 4–5. Record the change. |
| **Too slow** (>5k pages) | Block by title token or category, then compare within blocks. |
| **Everything looks alarming** | Sample 5 flagged pairs by hand before believing the count. Detectors over-fire on templated pages (shared boilerplate inflates similarity). |
| **Extraction failures** | Pages under 50 chars are usually a broken parser, not bad ingest. Fix the pipeline before measuring it. |

---

## What this does NOT tell you

Stage 0 measures **structure, not usefulness**. A perfectly deduplicated wiki can
still answer questions badly. Answer quality is Stage 2 (`run-eval.js`) and needs
~10 questions with known answers — that's the next session, not this one.

Do not claim "our wiki is healthy" from Stage 0. Claim "our wiki has N duplicates
and M conflicts", which is true and useful.

---

## If time remains: start Stage 1

Ask the team: *"what should this wiki be able to answer?"* Write down 10 questions
with, for each, the right answer **and the stale/wrong value** if one exists. That
list is the expensive asset; `run-eval.js` is trivial once it exists.

---

## Done for today

- [ ] `listPages()` works
- [ ] validity check run, verdict recorded
- [ ] health pass run, output saved to `health.jsonl`
- [ ] baseline written down **with date and thresholds**
- [ ] one sentence on what you'd change in ingest, based on which number was worst

That last line is the pitch.
