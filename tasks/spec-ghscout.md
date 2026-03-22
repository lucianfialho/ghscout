# ghscout — Spec v2

> Evidence engine for product discovery from GitHub issues.
> CLI first, web later if validated. Open source. Target: indie hackers.

---

## 1. Problem Statement

**What:** Indie hackers who want to find SaaS/tool ideas have dozens of tools that mine Reddit (SaasFinder, GummySearch, BigIdeasDB). But nobody systematically mines **GitHub issues** — the richest source of developer pain with structured data: reactions, labels, linked PRs, repo stars, code context.

GitHub issues are better than Reddit for product discovery because:
- **Structured data** — reactions (👍 = demand), labels (bug/feature), linked PRs (someone tried to solve it)
- **Quantifiable pain** — 47 issues across 12 repos about the same problem is hard evidence, not vibes
- **Developer-native** — the target customer (indie hacker dev) already lives on GitHub
- **Untapped** — every competitor mines Reddit. Zero tools mine GitHub issues at scale for product ideas.

**Why now:** The "mine Reddit for SaaS ideas" category exploded in 2025-2026 with 5+ paid tools. GitHub is the obvious next data source but nobody moved on it. First mover advantage is real here.

---

## 2. User Stories

### US-1: Scan a repo for product opportunities

**As an** indie hacker,
**I want** to analyze a popular repo's issues for recurring pain patterns,
**so that** I can find problems worth building a product around.

**Acceptance Criteria:**
- [ ] `ghscout scan vercel/next.js` fetches recent issues + PRs
- [ ] Groups issues into clusters by theme (keyword similarity, label overlap)
- [ ] Each cluster shows: issue count, total 👍 reactions, frustration signals, example issues with URLs
- [ ] Identifies "rejected demand" — closed PRs (not merged) that had positive reactions
- [ ] Identifies "workaround patterns" — issues where comments contain workaround code/links
- [ ] `--period 30d` filters by time window (default: 90d)
- [ ] `--limit 200` caps issues fetched (default: 100)
- [ ] Output: json, table, pretty

### US-2: Scan across an org or topic

**As an** indie hacker,
**I want** to scan multiple repos at once,
**so that** I can find cross-project pain that affects an entire ecosystem.

**Acceptance Criteria:**
- [ ] `ghscout scan --org vercel` scans top repos of an org
- [ ] `ghscout scan --topic devtools --min-stars 500` scans trending repos in a category
- [ ] Aggregates clusters across repos — "auth issues" found in 5/12 repos scanned
- [ ] `--min-stars` filters which repos to include (default: 100)
- [ ] Shows which repos have the most unaddressed pain

### US-3: Evidence package for a specific topic

**As an** indie hacker who spotted a pattern,
**I want** to deep-dive on a specific cluster,
**so that** I can validate the opportunity with hard numbers.

**Acceptance Criteria:**
- [ ] `ghscout evidence vercel/next.js "auth middleware"` searches issues matching a topic
- [ ] Returns: all matching issues with titles, URLs, reactions, status, age
- [ ] Shows: total affected users (unique commenters), total 👍, repos affected
- [ ] Shows: existing solutions attempted (linked PRs, referenced packages)
- [ ] Output is structured enough to paste into a pitch or README

### US-4: Discover trending pain across GitHub

**As an** indie hacker without a specific repo in mind,
**I want** to find what developers are complaining about right now,
**so that** I can spot emerging opportunities.

**Acceptance Criteria:**
- [ ] `ghscout trending` shows top pain clusters across popular repos
- [ ] `ghscout trending --topic cli` filters by topic
- [ ] `ghscout trending --lang typescript` filters by language
- [ ] Uses GitHub search API: issues with most reactions, sorted by recent
- [ ] Groups results into themes

---

## 3. Opportunity Scoring

Each cluster gets an **opportunity score** based on:

| Signal | Weight | How |
|---|---|---|
| **Demand** | 30% | Total 👍 reactions + "+1" comments across issues in cluster |
| **Frequency** | 25% | Number of separate issues about the same pain |
| **Frustration** | 15% | 👎 reactions, "broken", "frustrated", "please fix" keywords, issue age without resolution |
| **Market size** | 15% | Combined star count of affected repos (proxy for user base) |
| **Gap** | 15% | No existing solution: no linked PRs merged, no packages referenced in workarounds |

Score is 0-100. Breakdown shown in pretty output.

---

## 4. Clustering Strategy

Simple heuristics, no ML (v1):

1. **Title tokenization** — split titles into words, remove stopwords, count bigram frequency
2. **Label grouping** — issues sharing labels get grouped
3. **Reaction weighting** — 👍 reactions amplify cluster importance
4. **Rejected PR detection** — closed (not merged) PRs with 3+ 👍 = unmet demand signal
5. **Workaround detection** — comments containing code blocks or npm package names = people hacking around the problem
6. **Cross-repo dedup** — same keywords across repos merge into one cluster

Output: ranked clusters with issue count, total reactions, frustration score, example issues.

---

## 5. GitHub API Strategy

- **Auth:** Works without token (60 req/h). Recommends `GITHUB_TOKEN` or `gh auth` (5000 req/h). Detects `gh` CLI automatically.
- **Core endpoints:**
  - `GET /search/issues` — search issues by repo/org/topic with reactions sort
  - `GET /repos/{owner}/{repo}/issues` — issues with labels, reactions
  - `GET /repos/{owner}/{repo}/pulls?state=closed` — closed PRs (check merged vs rejected)
  - `GET /search/repositories` — find repos by topic/language/stars
  - `GET /orgs/{org}/repos` — list org repos
- **Rate limiting:**
  - Track `X-RateLimit-Remaining` header
  - Warn at 20% remaining
  - Graceful degradation: return partial results with warning
- **Caching:**
  - `~/.cache/ghscout/` file-based cache
  - Repo metadata: 24h TTL
  - Issue data: 1h TTL
  - Cache key: URL + query params hash

---

## 6. CLI Interface

```
ghscout scan <repo>              Scan a repo for opportunity clusters
ghscout scan --org <org>         Scan an org's repos
ghscout scan --topic <topic>     Scan trending repos in a topic
ghscout evidence <repo> <query>  Deep-dive on a specific pain topic
ghscout trending                 Top pain clusters across GitHub right now

Global options:
  --output <format>    json | table | pretty (default: pretty in TTY)
  --limit <n>          Max issues to fetch per repo (default: 100)
  --period <duration>  Time window: 7d, 30d, 90d (default: 90d)
  --min-stars <n>      Min repo stars to include (default: 100)
  --verbose            Show API calls and rate limit status
  --no-cache           Skip cache, fetch fresh data
  --help

Scan options:
  --top <n>            Top N clusters to show (default: 10)
  --min-reactions <n>  Min total reactions for a cluster (default: 5)

Evidence options:
  --sort <field>       reactions | recent | comments (default: reactions)

Trending options:
  --lang <languages>   Filter by language
  --topic <topics>     Filter by topic
```

---

## 7. Tech Stack

- **Runtime:** Node.js 18+ / TypeScript
- **CLI:** Commander
- **HTTP:** Native fetch (GitHub REST API v3)
- **Auth:** `GITHUB_TOKEN` env, `gh auth token` fallback, or unauthenticated
- **Cache:** File-based JSON, `~/.cache/ghscout/`, sha256 keyed
- **Output:** json, table, pretty (reuse pattern from spec2cli)
- **Testing:** Vitest (unit + integration with fixture data)
- **Deps:** commander, yaml. That's it. Zero AI deps in v1.

---

## 8. Non-Goals (v1)

- **NOT AI-powered** — heuristic clustering only. AI analysis is a v2 feature or "pipe to Claude" workflow.
- **NOT a web app** — CLI first. Web dashboard is a post-validation decision.
- **NOT Reddit/HN** — GitHub issues only. Single data source, done well.
- **NOT a notification system** — run it when you want, no cron, no alerts.
- **NOT a contribution finder** — focused on product opportunities, not "good first issues". Contributing to OSS is a separate use case that can be added later.
- **NOT monetized** — open source. Revenue model is not a v1 concern.

---

## 9. What Success Looks Like

1. **Dogfooding:** You (Lucian) use ghscout to find your next project idea. If it works for you, it works.
2. **Show HN / Reddit traction:** Post with real output showing opportunities found. "I scanned Next.js issues and found 5 product ideas with evidence."
3. **npm installs:** 100+ weekly installs in first month = validated.
4. **The ultimate test:** Someone actually builds a product from a ghscout finding.

---

## 10. Open Questions

1. **Name:** Need to check npm for `ghscout`, `issueradar`, `gaplens`. Also check GitHub for conflicts.
2. **Cluster quality:** Bigram extraction might be noisy with real data. May need to test with 2-3 real repos and iterate before shipping.
3. **Rate limits on `scan --org`:** Scanning all of Vercel's repos (50+ repos × 100 issues) = 5000+ requests. Need to cap repos per org (top 10 by stars?) or warn user.
4. **Rejected PR heuristic:** Need to distinguish "PR rejected because bad code" from "PR rejected because maintainer doesn't want the feature". Comment analysis needed but expensive.
5. **Positioning:** "Evidence engine" vs "idea finder" vs "opportunity scanner". Naming matters for marketing.
