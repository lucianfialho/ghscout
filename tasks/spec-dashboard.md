# ghscout dashboard — Spec

> Painel estático de oportunidades de produto gerado automaticamente pelo ghscout.
> Zero infra, zero custo. GitHub Action + JSON + HTML estático na Vercel.

---

## 1. Problem

O ghscout CLI gera dados valiosos mas efêmeros — roda uma vez, mostra no terminal, esquece. Não tem como:
- Acompanhar oportunidades ao longo do tempo
- Compartilhar resultados com outros devs
- Navegar visualmente por clusters
- Ver tendências (cluster X cresceu de 5 pra 15 issues em 4 semanas)

## 2. Solution

Site estático que:
1. Roda ghscout semanalmente via GitHub Action
2. Armazena resultados como JSON no repo (git = database)
3. Renderiza um dashboard navegável
4. Deploya automaticamente na Vercel

## 3. Architecture

```
ghscout/
├── .github/workflows/
│   └── weekly-scan.yml         ← Cron semanal
├── data/
│   ├── latest.json             ← Symlink/copy do scan mais recente
│   └── scans/
│       ├── 2026-03-22.json
│       ├── 2026-03-29.json
│       └── ...
├── dashboard/
│   ├── index.html              ← Single page, vanilla JS
│   ├── style.css
│   └── app.js                  ← Fetch JSONs, render table/cards
└── scan-config.json            ← Topics, min-stars, limits
```

## 4. Scan Config

```json
{
  "topics": ["developer-tools", "cli", "testing", "ai", "devops", "database"],
  "minStars": 500,
  "limit": 200,
  "top": 20
}
```

## 5. GitHub Action (weekly-scan.yml)

1. Checkout repo
2. Setup Node.js 18
3. Install ghscout
4. For each topic in scan-config.json:
   - Run `ghscout scan --topic {topic} --min-stars {minStars} --limit {limit} --top {top} --json`
5. Merge all results into one JSON: `data/scans/YYYY-MM-DD.json`
6. Copy to `data/latest.json`
7. Commit + push
8. Vercel auto-deploys

## 6. Data Format (per scan)

```json
{
  "date": "2026-03-22",
  "topics": ["developer-tools", "cli", "testing", "ai", "devops", "database"],
  "totalClusters": 120,
  "clusters": [
    {
      "topic": "developer-tools",
      "name": "st dataframe",
      "score": 97,
      "issueCount": 71,
      "totalReactions": 2312,
      "labels": ["type:enhancement"],
      "topIssues": [
        { "title": "st.tabs & st.expander...", "reactions": 99, "url": "...", "ageDays": 746 }
      ],
      "breakdown": { "demand": 100, "frequency": 100, "frustration": 81, "market": 100, "gap": 100 },
      "repos": ["streamlit/streamlit"]
    }
  ]
}
```

## 7. Dashboard (HTML estático)

### Layout
- Header: "ghscout — Product Opportunity Radar" + last scan date
- Filter bar: topic dropdown, min score slider, sort by (score, reactions, issues)
- Main: cards grid ou table view (toggle)
- Each card: cluster name, score badge (green/yellow/red), issue count, reactions, top issue title + link, topic tag

### Design
- Dark mode (como o landing do context7-cli — dark bg, green accent)
- Responsive
- Zero framework — vanilla HTML/CSS/JS
- Fetches `data/latest.json` on load
- Client-side filtering e sorting

### Card layout
```
┌─────────────────────────────────────┐
│ 97  st dataframe        [devtools]  │
│                                     │
│ 71 issues · 2,312 reactions         │
│ Demand: 100  Freq: 100  Frust: 81  │
│                                     │
│ → st.tabs & st.expander (746d)      │
│ → st.cache_resource async (736d)    │
└─────────────────────────────────────┘
```

## 8. Non-Goals

- Sem auth, sem login, sem accounts
- Sem backend, sem API, sem database
- Sem AI scoring no dashboard (só heurístico — AI scoring é caro pra cron)
- Sem histórico comparativo (v1 — mostra só latest)
- Sem SSR, sem framework JS

## 9. Files to Create

1. `scan-config.json` — topics e params
2. `.github/workflows/weekly-scan.yml` — cron action
3. `scripts/scan-all.sh` — script que o action chama
4. `dashboard/index.html` — page
5. `dashboard/style.css` — dark theme
6. `dashboard/app.js` — fetch + render
7. `vercel.json` — apontar build pra dashboard/

## 10. Success

- Site live em ghscout.vercel.app (ou similar)
- Atualiza semanalmente sem intervenção
- Dev acha o site, vê oportunidades, descobre o CLI
- Marketing do ghscout = o próprio dashboard
