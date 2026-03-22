const DATA_URL = "../data/latest.json";

let allClusters = [];
let scanDate = "";

async function init() {
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();

    scanDate = data.date || "unknown";
    allClusters = data.clusters || [];

    document.getElementById("meta").textContent =
      `Last scan: ${scanDate} | ${allClusters.length} clusters across ${data.topics?.length || 0} topics`;

    populateTopicFilter(data.topics || []);
    render();
  } catch (err) {
    document.getElementById("meta").textContent =
      "No scan data found. Run `bash scripts/scan-all.sh` to generate.";
    document.getElementById("empty").style.display = "block";
  }
}

function populateTopicFilter(topics) {
  const select = document.getElementById("topic-filter");
  for (const topic of topics) {
    const opt = document.createElement("option");
    opt.value = topic;
    opt.textContent = topic;
    select.appendChild(opt);
  }
}

function getFilters() {
  return {
    topic: document.getElementById("topic-filter").value,
    sortBy: document.getElementById("sort-by").value,
    minScore: parseInt(document.getElementById("min-score").value, 10),
  };
}

function filterAndSort(clusters, filters) {
  let filtered = clusters;

  if (filters.topic !== "all") {
    filtered = filtered.filter((c) => c.topic === filters.topic);
  }

  filtered = filtered.filter((c) => (c.score || 0) >= filters.minScore);

  // Exclude "other" clusters
  filtered = filtered.filter((c) => c.name !== "other");

  filtered.sort((a, b) => {
    switch (filters.sortBy) {
      case "reactions":
        return (b.totalReactions || 0) - (a.totalReactions || 0);
      case "issues":
        return (b.issueCount || 0) - (a.issueCount || 0);
      case "frustration":
        return (b.breakdown?.frustration || 0) - (a.breakdown?.frustration || 0);
      default:
        return (b.score || 0) - (a.score || 0);
    }
  });

  return filtered;
}

function scoreClass(score) {
  if (score > 70) return "score-high";
  if (score >= 40) return "score-mid";
  return "score-low";
}

function daysAgo(dateStr) {
  if (!dateStr) return "";
  const ms = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  return `${days}d`;
}

function renderCard(cluster, rank) {
  const score = cluster.score || 0;
  const breakdown = cluster.breakdown || {};
  const topIssues = (cluster.issues || cluster.topIssues || [])
    .slice()
    .sort((a, b) => (b.reactions?.total || b.reactions || 0) - (a.reactions?.total || a.reactions || 0))
    .slice(0, 3);

  const issuesHtml = topIssues
    .map((issue) => {
      const reactions = issue.reactions?.total ?? issue.reactions ?? 0;
      const title = (issue.title || "").length > 70
        ? issue.title.slice(0, 70) + "..."
        : issue.title || "";
      const age = daysAgo(issue.createdAt);
      const url = issue.htmlUrl || issue.url || "#";
      return `<a class="issue-link" href="${url}" target="_blank" rel="noopener">
        <span class="issue-reactions">${reactions} thumbsup</span> ${title} <span class="issue-age">(${age})</span>
      </a>`;
    })
    .join("");

  return `<div class="card">
    <div class="card-header">
      <span class="score-badge ${scoreClass(score)}">${score}</span>
      <span class="card-name">${cluster.name}</span>
      ${cluster.topic ? `<span class="topic-tag">${cluster.topic}</span>` : ""}
    </div>
    <div class="card-stats">
      ${cluster.issueCount || 0} issues &middot; ${(cluster.totalReactions || 0).toLocaleString()} reactions
      ${cluster.labels?.length ? " &middot; " + cluster.labels.join(", ") : ""}
    </div>
    <div class="card-breakdown">
      <span><span class="label">Demand</span> <span class="value">${breakdown.demand ?? "-"}</span></span>
      <span><span class="label">Freq</span> <span class="value">${breakdown.frequency ?? "-"}</span></span>
      <span><span class="label">Frust</span> <span class="value">${breakdown.frustration ?? "-"}</span></span>
      <span><span class="label">Gap</span> <span class="value">${breakdown.gap ?? "-"}</span></span>
    </div>
    ${topIssues.length ? `<div class="card-issues">${issuesHtml}</div>` : ""}
  </div>`;
}

function render() {
  const filters = getFilters();
  const filtered = filterAndSort(allClusters, filters);
  const container = document.getElementById("clusters");
  const empty = document.getElementById("empty");

  if (filtered.length === 0) {
    container.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  container.innerHTML = filtered.map((c, i) => renderCard(c, i + 1)).join("");
}

// Event listeners
document.getElementById("topic-filter").addEventListener("change", render);
document.getElementById("sort-by").addEventListener("change", render);
document.getElementById("min-score").addEventListener("input", (e) => {
  document.getElementById("min-score-label").textContent = `Min score: ${e.target.value}`;
  render();
});

init();
