# wiki-eval-kit

A small eval for an auto-ingested agent wiki. Answers one question:

> **Does our ingest pipeline produce a wiki that gives clean, trustworthy answers —
> and does it get better or worse when we change it?**

Generic by design: it talks to your system through one adapter file, so nothing
about your system lives in the kit.

## Setup

```bash
cp adapter.example.js adapter.js          # implement listPages() and ask()
cp questions.example.json questions.json  # write ~10 real questions
```

## The four stages — do them in this order

### Stage 0 · corpus health (free, no LLM, start here)

```bash
node corpus-health.js
```

Static metrics over the ingested wiki: near-duplicate pages, **conflicting pages**
(related pages asserting different values), orphans, staleness distribution.

`conflictPairs` is the number to drive to zero — conflicting pages are what turn
clean answers into hedges. This costs nothing, runs in seconds, and gives you a
before/after for any ingest change without a single model call. Run it today.

### Stage 1 · the golden question set (the real investment)

~10 questions with known answers, in `questions.json`. Sources, best first:

1. **Ask the team** — "what should this wiki be able to answer?" Doubles as socializing the eval.
2. **Real usage**, if there's traffic.
3. **Derived from documents** — pick a fact you know is in the sources, write the question.

For each, record the right answer **and the stale/wrong value** if one exists —
`reject` is what makes the metric meaningful. Include 2–3 questions whose answers
are genuinely *absent* (`mustSayUnknown`) to catch fabrication.

Ten good questions beat a hundred mediocre ones.

### Stage 2 · answer quality

```bash
node run-eval.js --runs 3
```

**Clean-answer rate**: an answer passes only if every `expect` matches AND no
`reject` matches.

Why `reject` matters: grading "does the right value appear?" scores a hedge —
*"the sources say 45 minutes or 30 minutes"* — as a pass. Measured on a testbed,
that lenient metric reported **100% for every condition while true quality
collapsed to 0%**. Grade for a *clean* answer, not a correct substring.

Grade with regex where you can (numbers, names, dates — most wiki facts). Add
`rubric` + `adapter.judge()` only for genuinely open-ended questions.

### Stage 3 · the comparison that proves value

```bash
node run-eval.js --runs 3 --conditions reconcile-on,reconcile-off
```

Your `ask()` receives `condition`, so you can A/B any ingest configuration —
reconciliation on/off, dedup threshold, staleness window — or compare
`wiki` vs `raw-sources` to test whether ingestion adds value at all.

**Freeze a source snapshot first.** If the corpus shifts between arms, the
comparison is meaningless.

### Stage 4 · the regression gate

```bash
node run-eval.js --runs 3 --json >> history.jsonl
node corpus-health.js --json >> health.jsonl
```

Run on every ingest change; append to history; alert when the rate drops. This is
what makes quality *owned* rather than observed — the pipeline can't change
without the number moving.

## Two rules that are easy to get wrong

1. **Report a rate, not a result.** These systems are stochastic. One passing run
   is not evidence; `--runs 3` (or more) is the minimum honest measurement.
2. **A lenient grader will tell you everything is fine.** If a metric never fails,
   suspect the metric before congratulating the pipeline.
