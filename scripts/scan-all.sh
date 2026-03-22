#!/bin/bash
# Scans all topics from scan-config.json and merges into a dated JSON file.
# Usage: bash scripts/scan-all.sh
# Requires: ghscout CLI installed, GITHUB_TOKEN set

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/scan-config.json"
DATE=$(date -u +%Y-%m-%d)
OUTPUT="$ROOT/data/scans/$DATE.json"

# Read config
TOPICS=$(node -e "const c = require('$CONFIG'); console.log(c.topics.join(' '))")
MIN_STARS=$(node -e "const c = require('$CONFIG'); console.log(c.minStars)")
LIMIT=$(node -e "const c = require('$CONFIG'); console.log(c.limit)")
TOP=$(node -e "const c = require('$CONFIG'); console.log(c.top)")

echo "ghscout weekly scan — $DATE"
echo "Topics: $TOPICS"
echo "Min stars: $MIN_STARS, Limit: $LIMIT, Top: $TOP"
echo ""

ALL_CLUSTERS="[]"

for TOPIC in $TOPICS; do
  echo "Scanning topic: $TOPIC..."

  RESULT=$(npx ghscout scan --topic "$TOPIC" --min-stars "$MIN_STARS" --limit "$LIMIT" --top "$TOP" --json 2>/dev/null || echo '{"clusters":[]}')

  # Extract clusters and add topic field to each
  TAGGED=$(echo "$RESULT" | node -e "
    const chunks = [];
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString());
        const clusters = (data.clusters || []).map(c => ({ ...c, topic: '$TOPIC' }));
        console.log(JSON.stringify(clusters));
      } catch { console.log('[]'); }
    });
  ")

  # Merge into all clusters
  ALL_CLUSTERS=$(node -e "
    const all = $ALL_CLUSTERS;
    const add = $TAGGED;
    console.log(JSON.stringify([...all, ...add]));
  ")

  echo "  Found $(echo "$TAGGED" | node -e "const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>console.log(JSON.parse(Buffer.concat(c).toString()).length))") clusters"
done

# Sort by score descending
SORTED=$(echo "$ALL_CLUSTERS" | node -e "
  const c=[];
  process.stdin.on('data',d=>c.push(d));
  process.stdin.on('end',()=>{
    const arr=JSON.parse(Buffer.concat(c).toString());
    arr.sort((a,b)=>(b.score||0)-(a.score||0));
    console.log(JSON.stringify(arr));
  });
")

# Build final output
TOTAL=$(echo "$SORTED" | node -e "const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>console.log(JSON.parse(Buffer.concat(c).toString()).length))")

node -e "
  const clusters = $SORTED;
  const output = {
    date: '$DATE',
    topics: '$TOPICS'.split(' '),
    totalClusters: clusters.length,
    clusters: clusters
  };
  console.log(JSON.stringify(output, null, 2));
" > "$OUTPUT"

# Copy to latest
cp "$OUTPUT" "$ROOT/data/latest.json"

echo ""
echo "Done! $TOTAL clusters saved to $OUTPUT"
echo "Latest: data/latest.json"
