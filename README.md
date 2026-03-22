# ghscout — evidence engine for product discovery from GitHub issues

Every idea tool mines Reddit. Nobody mines GitHub issues. **ghscout** does.

GitHub issues are the richest source of developer pain: structured reactions (👍 = demand), labels, linked PRs, repo stars, and code context. ghscout scans them at scale, clusters recurring pain patterns, and scores each opportunity so you can find problems worth building a product around.

## Install

```bash
npx ghscout scan vercel/next.js

# or install globally
npm install -g ghscout
```

Requires Node.js 18+. Works without a GitHub token (60 req/h), but set `GITHUB_TOKEN` or use `gh auth` for 5,000 req/h.

## Usage

### Scan a repo for opportunities

```bash
$ ghscout scan vercel/next.js

  Scanning vercel/next.js (100 issues, last 90d)...

  #1  Auth middleware breakage          score: 87
      23 issues · 412 👍 · 8 repos workarounds found
      → github.com/vercel/next.js/issues/58614
      → github.com/vercel/next.js/issues/61320

  #2  App Router caching confusion      score: 74
      18 issues · 289 👍 · 3 rejected PRs
      → github.com/vercel/next.js/issues/54173

  #3  Turbopack HMR failures            score: 61
      12 issues · 156 👍 · high frustration
      → github.com/vercel/next.js/issues/59845

  Found 10 opportunity clusters. 3 with score > 60.
```

### Scan an org or topic

```bash
$ ghscout scan --org vercel --min-stars 1000

  Scanning 14 repos in vercel (min 1000 stars)...

  #1  Edge runtime limitations          score: 82
      Found in 5/14 repos · 34 issues · 518 👍
  #2  Monorepo dependency resolution    score: 71
      Found in 3/14 repos · 19 issues · 247 👍
  ...

$ ghscout scan --topic devtools --min-stars 500

  Scanning 20 repos tagged "devtools"...

  #1  Config file proliferation         score: 79
      Found in 8/20 repos · 41 issues · 603 👍
  ...
```

### Deep-dive with evidence

```bash
$ ghscout evidence vercel/next.js "auth middleware"

  Evidence: "auth middleware" in vercel/next.js

  Matching issues:        23
  Total 👍 reactions:     412
  Unique commenters:      187
  Oldest unresolved:      14 months
  Rejected PRs:           3 (with 89 combined 👍)
  Workarounds found:      8 (next-auth, iron-session, custom edge logic)

  Top issues by reactions:
    #58614  Middleware auth redirects fail on prefetch  (148 👍)
    #61320  Session cookie not forwarded in middleware  (97 👍)
    #59201  Auth middleware runs twice on soft nav      (72 👍)

  Verdict: High unmet demand. Multiple workarounds, no merged fix.
```

### Discover trending pain

```bash
$ ghscout trending --topic cli

  Trending pain clusters (topic: cli, last 30d)

  #1  Shell completion inconsistencies  score: 68
      9 repos · 22 issues · 198 👍
  #2  Config migration breaking changes score: 63
      6 repos · 15 issues · 134 👍
  #3  Windows path handling             score: 59
      11 repos · 31 issues · 112 👍
```

## Scoring Model

Each opportunity cluster gets a score from 0-100 based on five signals:

| Signal | Weight | What it measures |
|---|---|---|
| **Demand** | 30% | Total 👍 reactions and "+1" comments across issues |
| **Frequency** | 25% | Number of separate issues about the same pain |
| **Frustration** | 15% | Negative reactions, angry keywords, issue age without resolution |
| **Market size** | 15% | Combined star count of affected repos (proxy for user base) |
| **Gap** | 15% | No existing solution: no merged PRs, no packages referenced |

## How it works

No ML, no AI dependencies. v1 uses deterministic heuristics:

1. Title tokenization + bigram frequency to find recurring themes
2. Label grouping to cluster related issues
3. Reaction weighting to amplify importance
4. Rejected PR detection (closed, not merged, with 👍) for unmet demand signals
5. Workaround detection from code blocks and package references in comments
6. Cross-repo deduplication when scanning orgs or topics

Results are cached in `~/.cache/ghscout/` (issues: 1h TTL, repo metadata: 24h TTL).

## Comparison

| | **ghscout** | SaasFinder | GummySearch |
|---|---|---|---|
| Data source | GitHub issues | Reddit | Reddit |
| Structured signals | 👍 reactions, labels, PRs | Upvotes, comments | Upvotes, comments |
| Developer focus | Built for it | General SaaS | General SaaS |
| Cross-repo analysis | Yes | N/A | N/A |
| Rejected PR detection | Yes | N/A | N/A |
| Price | Free / open source | $29/mo+ | $48/mo+ |

## Autoresearch

ghscout outputs structured JSON (`--output json`) designed to feed into autonomous research loops. Pipe results into AI agents for deeper analysis:

```bash
ghscout scan --topic devtools --output json | your-agent-pipeline
```

See `program.md` in the repo for patterns on building autonomous research workflows with ghscout as the evidence layer.

## Options

```
ghscout scan <repo>              Scan a repo for opportunity clusters
ghscout scan --org <org>         Scan an org's repos
ghscout scan --topic <topic>     Scan repos by GitHub topic
ghscout evidence <repo> <query>  Deep-dive on a specific pain topic
ghscout trending                 Top pain clusters across GitHub

Global:
  --output <format>    json | table | pretty (default: pretty)
  --limit <n>          Max issues per repo (default: 100)
  --period <duration>  Time window: 7d, 30d, 90d (default: 90d)
  --min-stars <n>      Min stars to include (default: 100)
  --verbose            Show API calls and rate limits
  --no-cache           Fetch fresh data
```

## License

MIT
