#!/bin/bash
set -e
cd "$(dirname "$0")/.."

DATE=$(date -u +%Y-%m-%d)
TMPDIR=$(mktemp -d)

echo "Generating seed data for dashboard..."
echo ""

npx tsx src/index.ts scan --topic developer-tools --min-stars 500 --top 15 --json 2>/dev/null > "$TMPDIR/developer-tools.json" && echo "developer-tools: done" || echo "developer-tools: failed"
npx tsx src/index.ts scan --topic cli --min-stars 500 --top 15 --json 2>/dev/null > "$TMPDIR/cli.json" && echo "cli: done" || echo "cli: failed"
npx tsx src/index.ts scan --topic testing --min-stars 500 --top 15 --json 2>/dev/null > "$TMPDIR/testing.json" && echo "testing: done" || echo "testing: failed"
npx tsx src/index.ts scan --topic ai --min-stars 500 --top 15 --json 2>/dev/null > "$TMPDIR/ai.json" && echo "ai: done" || echo "ai: failed"
npx tsx src/index.ts scan --topic devops --min-stars 500 --top 15 --json 2>/dev/null > "$TMPDIR/devops.json" && echo "devops: done" || echo "devops: failed"
npx tsx src/index.ts scan --topic database --min-stars 500 --top 15 --json 2>/dev/null > "$TMPDIR/database.json" && echo "database: done" || echo "database: failed"
npx tsx src/index.ts scan --topic authentication --min-stars 500 --top 15 --json 2>/dev/null > "$TMPDIR/authentication.json" && echo "authentication: done" || echo "authentication: failed"

echo ""
echo "Merging results..."

node -e "
const fs = require('fs');
const path = require('path');
const tmpdir = process.argv[1];
const date = process.argv[2];
const topics = ['developer-tools','cli','testing','ai','devops','database','authentication'];
const allClusters = [];

for (const topic of topics) {
  const file = path.join(tmpdir, topic + '.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    const clusters = (data.clusters || []).map(cl => ({
      ...cl,
      topic,
      issues: (cl.issues || []).slice(0, 5).map(i => ({
        title: i.title,
        reactions: i.reactions,
        htmlUrl: i.htmlUrl,
        createdAt: i.createdAt,
        labels: i.labels
      }))
    }));
    allClusters.push(...clusters);
    console.log(topic + ': ' + clusters.length + ' clusters');
  } catch (e) {
    console.log(topic + ': 0 clusters (error)');
  }
}

allClusters.sort((a, b) => (b.score || 0) - (a.score || 0));

const output = { date, topics, totalClusters: allClusters.length, clusters: allClusters };
fs.writeFileSync('data/latest.json', JSON.stringify(output, null, 2));
console.log('');
console.log('Total: ' + allClusters.length + ' clusters → data/latest.json');
" "$TMPDIR" "$DATE"

rm -rf "$TMPDIR"
