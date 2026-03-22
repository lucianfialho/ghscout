# ghscout -- Autonomous Product Discovery

Run systematic product discovery sessions by mining GitHub issues for developer pain.
Inspired by karpathy/autoresearch. Designed to be executed autonomously by an AI agent.

## Setup

- Install: `npm install -g ghscout` (or use `npx ghscout`)
- Set `GITHUB_TOKEN` env var for 5000 req/h (vs 60 without)
- Output dir: create `discoveries/` in working directory if missing

## Research Session

### Phase 1: Broad Scan

Scan across six topic areas. Goal: find high-scoring clusters.

```
TOPICS=(devtools ai frontend backend infra databases)
```

For each topic:
1. Run `ghscout scan --topic {topic} --min-stars 500 --output json --top 20 > /tmp/ghscout-{topic}.json`
2. Parse the JSON output
3. Collect every cluster with opportunity score > 70 into a candidates list
4. Note: topic, cluster name, score, repo(s), issue count, total reactions

Expected: 2-8 candidates per topic, 10-30 total.

### Phase 2: Deep Dive

For each candidate from Phase 1:
1. Run `ghscout evidence {repo} "{cluster name}" --output json --sort reactions`
2. Evaluate the opportunity:
   - **Strong signal**: 10+ issues across 2+ repos, 50+ total reactions
   - **Existing solutions**: Are linked PRs/packages adequate? If yes, skip.
   - **Buildable**: Could an indie hacker ship an MVP in 2-4 weeks?
   - **Market**: Combined star count of affected repos > 5000 = real user base
3. Assign verdict:
   - **BUILD** -- Clear pain, no good solution, buildable scope
   - **WATCH** -- Real pain but existing solutions or unclear scope
   - **SKIP** -- Noise, already solved, or too niche

### Phase 3: Report

Write findings to `discoveries/YYYY-MM-DD.md` using this template:

```markdown
# Discovery Session -- YYYY-MM-DD

## Summary
- Topics scanned: {list}
- Clusters evaluated: {n}
- BUILD: {n} | WATCH: {n} | SKIP: {n}

## BUILD Verdicts

### {Cluster Name}
- **Score**: {n}/100
- **Signal**: {issue_count} issues, {reaction_count} reactions, {repo_count} repos
- **Pain**: {one-line description of the problem}
- **Gap**: {why existing solutions fail}
- **Scope**: {what an MVP looks like}
- **Key issues**: {top 3 issue URLs}
- **Verdict**: BUILD

## WATCH Verdicts
(same format, shorter notes)
```

### Phase 4: Refine

1. Review which topics produced the most BUILD verdicts
2. Try adjacent topics or narrower scans on productive areas
3. Run `ghscout trending --topic {best-topic}` to catch emerging pain
4. Experiment with `--min-stars 200` for less competitive niches
5. Repeat Phases 2-3 for any new findings
6. Append new discoveries to the same day's report

## Metric

Success = BUILD verdicts per session. Target: 3+ actionable ideas per run.

## Example Discovery Entry

```markdown
### Monorepo Config Sync
- **Score**: 82/100
- **Signal**: 34 issues, 187 reactions, 6 repos (turborepo, nx, lerna, rush, moon, biome)
- **Pain**: Keeping tsconfig, eslint, prettier configs in sync across monorepo packages
- **Gap**: Existing tools (syncpack, manypkg) only handle package.json versions, not config files
- **Scope**: CLI that diffs configs across packages, suggests unified config, auto-syncs on change
- **Key issues**: vercel/turborepo#4521, nrwl/nx#18203, biomejs/biome#1847
- **Verdict**: BUILD
```

## Notes

- If rate-limited, wait for the reset window. Partial results are still useful.
- Cache lives at `~/.cache/ghscout/`. Use `--no-cache` only when re-validating.
- Pipe raw JSON to other tools if needed: `ghscout scan ... --output json | jq '.clusters[]'`
- Keep sessions under 1 hour. Breadth beats depth in early discovery.
