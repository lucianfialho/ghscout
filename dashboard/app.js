const DATA_URL = "../data/latest.json";

let allData = null;
let currentView = "topics"; // "topics" | "clusters" | "detail"
let currentTopic = null;
let currentCluster = null;

async function init() {
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`${res.status}`);
    allData = await res.json();

    document.getElementById("meta").textContent =
      `Last scan: ${allData.date} | ${allData.totalClusters} clusters across ${allData.topics?.length || 0} topics`;

    renderTopics();
  } catch (err) {
    document.getElementById("meta").textContent =
      "No scan data found. Run `bash scripts/scan-all.sh` to generate.";
    document.getElementById("content").innerHTML = `<div class="empty">No data available.</div>`;
  }
}

// --- Topic overview ---

function getTopicStats(topic) {
  const clusters = allData.clusters.filter((c) => c.topic === topic && c.name !== "other");
  const totalIssues = clusters.reduce((s, c) => s + (c.issueCount || 0), 0);
  const totalReactions = clusters.reduce((s, c) => s + (c.totalReactions || 0), 0);
  const topScore = clusters.length > 0 ? Math.max(...clusters.map((c) => c.score || 0)) : 0;
  return { clusters: clusters.length, totalIssues, totalReactions, topScore };
}

function renderTopics() {
  currentView = "topics";
  currentTopic = null;
  currentCluster = null;

  const nav = document.getElementById("breadcrumb");
  nav.innerHTML = `<span class="bc-current">Topics</span>`;

  const content = document.getElementById("content");
  const topics = allData.topics || [];

  if (topics.length === 0) {
    content.innerHTML = `<div class="empty">No topics found.</div>`;
    return;
  }

  const cards = topics.map((topic) => {
    const stats = getTopicStats(topic);
    return `<div class="topic-card" onclick="selectTopic('${topic}')">
      <div class="topic-name">${topic}</div>
      <div class="topic-stats">
        <span>${stats.clusters} clusters</span>
        <span>${stats.totalIssues} issues</span>
        <span>${stats.totalReactions.toLocaleString()} reactions</span>
      </div>
      <div class="topic-score">Top score: <span class="${scoreClass(stats.topScore)}">${stats.topScore}</span></div>
    </div>`;
  }).join("");

  content.innerHTML = `<div class="topic-grid">${cards}</div>`;
  document.getElementById("filters").style.display = "none";
}

// --- Cluster list for a topic ---

function selectTopic(topic) {
  currentView = "clusters";
  currentTopic = topic;
  currentCluster = null;

  const nav = document.getElementById("breadcrumb");
  nav.innerHTML = `<a class="bc-link" onclick="renderTopics()">Topics</a> <span class="bc-sep">→</span> <span class="bc-current">${topic}</span>`;

  document.getElementById("filters").style.display = "flex";
  renderClusters();
}

function renderClusters() {
  const filters = getFilters();
  let clusters = allData.clusters.filter((c) => c.topic === currentTopic && c.name !== "other");

  clusters = clusters.filter((c) => (c.score || 0) >= filters.minScore);

  clusters.sort((a, b) => {
    switch (filters.sortBy) {
      case "reactions": return (b.totalReactions || 0) - (a.totalReactions || 0);
      case "issues": return (b.issueCount || 0) - (a.issueCount || 0);
      case "frustration": return (b.breakdown?.frustration || 0) - (a.breakdown?.frustration || 0);
      default: return (b.score || 0) - (a.score || 0);
    }
  });

  const content = document.getElementById("content");

  if (clusters.length === 0) {
    content.innerHTML = `<div class="empty">No clusters match your filters.</div>`;
    return;
  }

  content.innerHTML = `<div class="clusters">${clusters.map((c, i) => renderClusterCard(c, i + 1)).join("")}</div>`;
}

function renderClusterCard(cluster, rank) {
  const score = cluster.score || 0;
  const breakdown = cluster.breakdown || {};
  const topIssues = getTopIssues(cluster, 2);
  const insights = generateInsights(cluster);

  const issuesHtml = topIssues.map((issue) => {
    const reactions = issue.reactions?.total ?? issue.reactions ?? 0;
    const title = truncate(issue.title, 70);
    const age = daysAgo(issue.createdAt);
    return `<div class="issue-preview">
      <span class="issue-reactions">${reactions} 👍</span> ${title} <span class="issue-age">(${age})</span>
    </div>`;
  }).join("");

  const labelsStr = cluster.labels?.length ? cluster.labels.join(", ") : "";

  return `<div class="card" onclick="selectCluster('${escape(cluster.name)}')">
    <div class="card-header">
      <span class="card-rank">#${rank}</span>
      <span class="score-badge ${scoreClass(score)}">${score}</span>
      <span class="card-name">${cluster.name}</span>
      <span class="card-arrow">→</span>
    </div>
    <div class="card-stats">
      ${cluster.issueCount || 0} issues · ${(cluster.totalReactions || 0).toLocaleString()} reactions${labelsStr ? " · " + labelsStr : ""}
    </div>
    ${renderInsights(insights)}
    <div class="card-breakdown">
      <span><span class="label">Demand</span> <span class="value">${breakdown.demand ?? "-"}</span></span>
      <span><span class="label">Freq</span> <span class="value">${breakdown.frequency ?? "-"}</span></span>
      <span><span class="label">Frust</span> <span class="value">${breakdown.frustration ?? "-"}</span></span>
      <span><span class="label">Gap</span> <span class="value">${breakdown.gap ?? "-"}</span></span>
    </div>
    ${topIssues.length ? `<div class="card-issues">${issuesHtml}</div>` : ""}
  </div>`;
}

// --- Cluster detail view ---

function selectCluster(escapedName) {
  const name = unescape(escapedName);
  const cluster = allData.clusters.find((c) => c.topic === currentTopic && c.name === name);
  if (!cluster) return;

  currentView = "detail";
  currentCluster = cluster;

  const nav = document.getElementById("breadcrumb");
  nav.innerHTML = `<a class="bc-link" onclick="renderTopics()">Topics</a> <span class="bc-sep">→</span> <a class="bc-link" onclick="selectTopic('${currentTopic}')">${currentTopic}</a> <span class="bc-sep">→</span> <span class="bc-current">${name}</span>`;

  document.getElementById("filters").style.display = "none";

  const score = cluster.score || 0;
  const breakdown = cluster.breakdown || {};
  const allIssues = getTopIssues(cluster, 50);

  const issueRows = allIssues.map((issue, i) => {
    const reactions = issue.reactions?.total ?? issue.reactions ?? 0;
    const title = truncate(issue.title, 80);
    const age = daysAgo(issue.createdAt);
    const url = issue.htmlUrl || issue.url || "#";
    const labels = issue.labels?.length ? `<span class="detail-labels">${issue.labels.join(", ")}</span>` : "";
    return `<tr>
      <td class="col-rank">${i + 1}</td>
      <td class="col-reactions"><span class="issue-reactions">${reactions} 👍</span></td>
      <td class="col-title">
        <a href="${url}" target="_blank" rel="noopener">${title}</a>
        ${labels}
      </td>
      <td class="col-age">${age}</td>
    </tr>`;
  }).join("");

  const insights = generateInsights(cluster);
  const content = document.getElementById("content");
  content.innerHTML = `
    <div class="detail">
      <div class="detail-header">
        <span class="score-badge big ${scoreClass(score)}">${score}</span>
        <div>
          <h2>${name}</h2>
          <p class="detail-meta">${cluster.issueCount || 0} issues · ${(cluster.totalReactions || 0).toLocaleString()} reactions${cluster.labels?.length ? " · " + cluster.labels.join(", ") : ""}</p>
        </div>
      </div>

      ${insights.length ? `<div class="detail-insights">${renderInsights(insights)}</div>` : ""}

      <div class="detail-breakdown">
        <div class="breakdown-item">
          <div class="breakdown-value ${scoreClass(breakdown.demand || 0)}">${breakdown.demand ?? 0}</div>
          <div class="breakdown-label">Demand</div>
        </div>
        <div class="breakdown-item">
          <div class="breakdown-value ${scoreClass(breakdown.frequency || 0)}">${breakdown.frequency ?? 0}</div>
          <div class="breakdown-label">Frequency</div>
        </div>
        <div class="breakdown-item">
          <div class="breakdown-value ${scoreClass(breakdown.frustration || 0)}">${breakdown.frustration ?? 0}</div>
          <div class="breakdown-label">Frustration</div>
        </div>
        <div class="breakdown-item">
          <div class="breakdown-value ${scoreClass(breakdown.gap || 0)}">${breakdown.gap ?? 0}</div>
          <div class="breakdown-label">Gap</div>
        </div>
      </div>

      <h3>All Issues (${allIssues.length})</h3>
      <table class="detail-table">
        <thead>
          <tr>
            <th>#</th>
            <th>👍</th>
            <th>Title</th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>${issueRows}</tbody>
      </table>

      <div class="detail-actions">
        <a class="btn" href="https://github.com/lucianfialho/ghscout" target="_blank" rel="noopener">Run deeper analysis with ghscout CLI →</a>
      </div>
    </div>
  `;
}

// --- Helpers ---

function getTopIssues(cluster, n) {
  return (cluster.issues || cluster.topIssues || [])
    .slice()
    .sort((a, b) => (b.reactions?.total || b.reactions || 0) - (a.reactions?.total || a.reactions || 0))
    .slice(0, n);
}

function scoreClass(score) {
  if (score > 70) return "score-high";
  if (score >= 40) return "score-mid";
  return "score-low";
}

function daysAgo(dateStr) {
  if (!dateStr) return "";
  const ms = Date.now() - new Date(dateStr).getTime();
  return `${Math.floor(ms / (1000 * 60 * 60 * 24))}d`;
}

function generateInsights(cluster) {
  const insights = [];
  const b = cluster.breakdown || {};
  const issues = cluster.issues || [];
  const score = cluster.score || 0;

  // High demand, low solutions
  if ((b.demand || 0) > 70 && (b.gap || 0) > 80) {
    insights.push({ icon: "🔥", text: "High demand, no solution yet", type: "hot" });
  }

  // Chronic pain (high frustration + old issues)
  if ((b.frustration || 0) > 60) {
    const oldIssues = issues.filter(i => {
      const age = (Date.now() - new Date(i.createdAt).getTime()) / (1000*60*60*24);
      return age > 365;
    });
    if (oldIssues.length >= 2) {
      insights.push({ icon: "⏳", text: `${oldIssues.length} issues older than 1 year — chronic pain`, type: "chronic" });
    }
  }

  // Many issues = widespread
  if ((cluster.issueCount || 0) > 20) {
    insights.push({ icon: "📢", text: "Widespread problem (20+ issues)", type: "widespread" });
  }

  // High reactions per issue = strong signal
  const avgReactions = (cluster.totalReactions || 0) / Math.max(cluster.issueCount || 1, 1);
  if (avgReactions > 20) {
    insights.push({ icon: "💡", text: `Strong signal — avg ${Math.round(avgReactions)} reactions/issue`, type: "signal" });
  }

  // Potential product types
  if (score > 60) {
    const name = (cluster.name || "").toLowerCase();
    if (name.includes("cli") || name.includes("command")) {
      insights.push({ icon: "⌨️", text: "Potential: CLI tool or dev tool", type: "idea" });
    } else if (name.includes("ui") || name.includes("component") || name.includes("layout")) {
      insights.push({ icon: "🎨", text: "Potential: UI library or component", type: "idea" });
    } else if (name.includes("api") || name.includes("auth") || name.includes("data")) {
      insights.push({ icon: "🔌", text: "Potential: API service or middleware", type: "idea" });
    } else if (name.includes("test") || name.includes("debug")) {
      insights.push({ icon: "🧪", text: "Potential: Testing/debugging tool", type: "idea" });
    } else {
      insights.push({ icon: "🚀", text: "Potential: Standalone tool or extension", type: "idea" });
    }
  }

  return insights;
}

function renderInsights(insights) {
  if (insights.length === 0) return "";
  return `<div class="insights">${insights.map(i =>
    `<span class="insight insight-${i.type}">${i.icon} ${i.text}</span>`
  ).join("")}</div>`;
}

function truncate(str, n) {
  if (!str) return "";
  return str.length > n ? str.slice(0, n) + "..." : str;
}

function escape(str) {
  return encodeURIComponent(str);
}

function unescape(str) {
  return decodeURIComponent(str);
}

function getFilters() {
  return {
    sortBy: document.getElementById("sort-by").value,
    minScore: parseInt(document.getElementById("min-score").value, 10),
  };
}

// --- Event listeners ---
document.getElementById("sort-by").addEventListener("change", () => {
  if (currentView === "clusters") renderClusters();
});
document.getElementById("min-score").addEventListener("input", (e) => {
  document.getElementById("min-score-label").textContent = `Min score: ${e.target.value}`;
  if (currentView === "clusters") renderClusters();
});

init();
