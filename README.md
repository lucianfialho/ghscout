# ghscout — evidence engine for product discovery from GitHub issues

Every idea tool mines Reddit. Nobody mines GitHub issues. **ghscout** does.

GitHub issues are the richest source of developer pain: structured reactions, labels, linked PRs, repo stars, and code context. ghscout scans them at scale, clusters recurring pain patterns, and scores each opportunity.

## Install

```bash
npx ghscout scan vercel/next.js

# or install globally
npm install -g ghscout
```

Requires Node.js 18+. Works without a GitHub token (60 req/h), but set `GITHUB_TOKEN` or use `gh auth` for 5,000 req/h.

## Scan a repo

```
$ ghscout scan vercel/next.js --top 5

#1 [100/100] server actions
   Issues: 25 | Reactions: 740 | Labels: bug
   Demand: 100  Frequency: 100  Frustration: 100  Market: 100  Gap: 100
   → [65 👍] Unable to import react-dom/server in a server component (1200d)
     https://github.com/vercel/next.js/issues/43810
   → [57 👍] Turbopack dev server uses too much RAM and CPU (263d)
     https://github.com/vercel/next.js/issues/81161

#2 [80/100] pages router
   Issues: 13 | Reactions: 663 | Labels: none
   Demand: 92  Frequency: 48  Frustration: 67  Market: 100  Gap: 100
   → [325 👍] App router issue with Framer Motion shared layout animatio... (1051d)
     https://github.com/vercel/next.js/issues/49279

#3 [58/100] compress false
   Issues: 10 | Reactions: 258 | Labels: Runtime, bug
   → [49 👍] middleware matcher should support template literals (899d)

#4 [54/100] parallel routes
   Issues: 8 | Reactions: 217 | Labels: bug
   → [54 👍] Parallel routes are rendered unnecessarily (967d)

#5 [48/100] image
   Issues: 8 | Reactions: 203 | Labels: Image (next/image), bug
   → [46 👍] next/image not properly sizing images (1186d)
```

## Scan across repos (org or topic)

```
$ ghscout scan --topic developer-tools --min-stars 1000 --top 5

Scanning 1/10: puppeteer/puppeteer...
Scanning 2/10: hoppscotch/hoppscotch...
...

#1 [97/100] st dataframe
   Issues: 71 | Reactions: 2312 | Labels: type:enhancement
   → [99 👍] st.tabs & st.expander - Improve handling of frontend... (746d)

#2 [61/100] bruno cli
   Issues: 37 | Reactions: 461 | Labels: enhancement
   → [131 👍] Import Open API / Swagger 2.x Spec into Bruno (1147d)

#3 [60/100] sandbox creation
   Issues: 44 | Reactions: 13
   → [2 👍] Live File Synchronization (daytona sandbox sync) (72d)
```

## AI scoring (via Claude Code)

Uses your existing Claude Code subscription. Zero extra cost, zero API key.

```
$ ghscout scan vercel/next.js --top 3 --ai-score

#1 [3/10] server actions  SKIP
   Issues: 25 | Reactions: 740 | Heuristic: 100/100
   AI: "These are Next.js framework bugs that need fixes from the
   core team, not standalone products. No indie tool can meaningfully
   solve server action cookie reloads or Turbopack memory leaks."

#2 [3/10] pages router  SKIP
   AI: "Framework-level routing bugs tightly coupled to Next.js
   internals. Best resolved upstream via PRs to the library itself."

#3 [3/10] parallel routes  SKIP
   AI: "Parallel routes issues are framework-level bugs in Next.js's
   routing engine that require fixes within Next.js itself."
```

The AI separates "real pain but not a product opportunity" from "pain you can build a product around." Heuristics gave server actions 100/100. AI gave it 3/10 with a clear rationale.

## Deep-dive with evidence

```
$ ghscout evidence vercel/next.js "middleware"

# Evidence: "middleware" in vercel/next.js

## Summary
- **17 open issues** across 16 unique authors
- **1,111 total 👍 reactions** — strong demand signal
- **20 related PRs**

## Top Issues by Demand
1. [195 👍] [RFC] Dynamic Routes (#7607)
   Opened 2468 days ago | 90 comments
2. [136 👍] trailing slash in link for legit page works for client side...
   Opened 2740 days ago | 124 comments
```

Output is plain markdown — paste it into a pitch deck, README, or blog post.

## Trending pain

```
$ ghscout trending --top 3

#1 [67/100] claude code
   Issues: 7 | Reactions: 513
   → [119 👍] Support multiple Connector accounts (29d)
   → [79 👍] remote-control shows misleading error (25d)

#2 [58/100] option
   Issues: 5 | Reactions: 583
   → [283 👍] Add collision presets (godot-proposals) (25d)

#3 [28/100] code
   Issues: 3 | Reactions: 263
   → [118 👍] Add a Shader Code variable previewer (18d)
```

## Scoring model

Scores are **relative within each scan** — the top cluster always gets the highest demand score, differentiating clusters from each other.

| Signal | Weight (single-repo) | Weight (cross-repo) | What it measures |
|---|---|---|---|
| **Demand** | 35% | 30% | Total 👍 reactions across issues |
| **Frequency** | 30% | 25% | Number of separate issues about the same pain |
| **Frustration** | 20% | 15% | Negative reactions, frustration keywords in title+body, issue age |
| **Market size** | 0% | 15% | Repo stars (constant in single-repo, varies in cross-repo) |
| **Gap** | 15% | 15% | Percentage of issues still open (no solution yet) |

## Autoresearch

ghscout ships with a `program.md` — a structured instruction file (inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch)) that teaches AI coding agents to run autonomous product discovery sessions.

```bash
# In Claude Code, just say:
"Read program.md and run a research session"
```

The agent scans topics, evaluates clusters, and writes findings to `discoveries/YYYY-MM-DD.md` with BUILD/SKIP/WATCH verdicts.

## CLI reference

```
ghscout scan <repo>              Scan a repo for opportunity clusters
ghscout scan --org <org>         Scan an org's repos
ghscout scan --topic <topic>     Scan repos by GitHub topic
ghscout evidence <repo> <query>  Deep-dive on a specific pain topic
ghscout trending                 Top pain clusters across GitHub

Options:
  --output <format>    json | table | pretty (default: pretty)
  --json               Shorthand for --output json
  --ai-score           Score with AI via Claude Code CLI
  --limit <n>          Max issues per repo (default: 200)
  --period <duration>  Time window: 7d, 30d, 90d (default: all open)
  --min-stars <n>      Min stars to include (default: 100)
  --top <n>            Show top N clusters
  --min-reactions <n>  Min reactions per cluster
  --verbose            Show API calls and rate limits
  --no-cache           Fetch fresh data
```

## Comparison

| | **ghscout** | SaasFinder | GummySearch |
|---|---|---|---|
| Data source | GitHub issues | Reddit | Reddit |
| AI scoring | Yes (Claude Code) | No | No |
| Structured signals | Reactions, labels, PRs | Upvotes, comments | Upvotes, comments |
| Cross-repo analysis | Yes | N/A | N/A |
| Rejected PR detection | Yes | N/A | N/A |
| Evidence packages | Yes (markdown) | No | No |
| Price | Free / open source | $29/mo+ | $48/mo+ |

## License

MIT
