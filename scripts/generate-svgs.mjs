// scripts/generate-svgs.mjs
// Node 18+（内置 fetch）
// 生成 assets/stats.svg 与 assets/streak.svg，支持主题/数字高亮/图案

import fs from "node:fs";
import path from "node:path";

// ---------- ENV ----------
const GH_LOGIN =
  process.env.GH_LOGIN ||
  process.env.GITHUB_REPOSITORY_OWNER ||
  (process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split("/")[0] : "") ||
  process.env.GITHUB_ACTOR ||
  "";

const TOKEN =
  process.env.PAT_READ_USER /* prefer PAT for private contributions */ ||
  process.env.GITHUB_TOKEN ||                                  // Actions token
  process.env.GH_TOKEN;                                        // local/gh CLI fallback

const SVG_THEME = (process.env.SVG_THEME || "default_light").toLowerCase();
const ACCENT    = process.env.ACCENT || "#22d3ee";
const NUM_STYLE = (process.env.NUM_STYLE || "accent").toLowerCase(); // "accent" | "pill"

if (!TOKEN || !GH_LOGIN) {
  console.error("Missing env: GITHUB_TOKEN/PAT_READ_USER or GH_LOGIN");
  process.exit(1);
}

// ---------- GraphQL ----------
const gql = async (query, variables = {}) => {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "stats-svg-action",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`GraphQL ${r.status}: ${t}`);
  }
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
};

const to = new Date();
const from = new Date(to);
from.setUTCDate(from.getUTCDate() - 365);

const QUERY = /* GraphQL */ `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      login
      starredRepositories { totalCount }
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalIssueContributions

        commitContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner }
        }
        issueContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner }
        }
        pullRequestContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner }
        }

        contributionCalendar {
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

// ---------- THEMES ----------
const THEMES = {
  default_light: {
    bg1: "#ffffff", bg2: "#f8fafc", border: "#e5e7eb",
    title: "#0f172a", label: "#475569", accent: "#2563eb", dot: "#e2e8f0"
  },
  vue: {
    bg1: "#ffffff", bg2: "#f2fbf7", border: "#d8f3e6",
    title: "#0f3b2e", label: "#2b5c45", accent: "#41b883", dot: "#cce9dd"
  },
  ayu_light: {
    bg1: "#fffaf5", bg2: "#faf3ea", border: "#eee4d9",
    title: "#1f2430", label: "#6c6f93", accent: "#ff9940", dot: "#e9ded1"
  },
  swift: {
    bg1: "#fff7fb", bg2: "#f5f3ff", border: "#eadff7",
    title: "#5b21b6", label: "#7c3aed", accent: "#a855f7", dot: "#e9d5ff"
  },
  rose_pine: {
    bg1: "#fffaf3", bg2: "#faf4ed", border: "#f2e9e1",
    title: "#575279", label: "#797593", accent: "#b4637a", dot: "#eaddcf"
  },
  rose_pine_dawn: {
    bg1: "#fffaf3", bg2: "#faf4ed", border: "#f2e9e1",
    title: "#575279", label: "#797593", accent: "#286983", dot: "#eaddcf"
  },
  slate: {
    bg1: "#f8fafc", bg2: "#eef2f7", border: "#e5e7eb",
    title: "#111827", label: "#374151", accent: "#0ea5e9", dot: "#e2e8f0"
  },
  midnight: {
    bg1: "#0f2331", bg2: "#0b1622", border: "#0b2534",
    title: "#e5f2fb", label: "#cbd5e1", accent: "#22d3ee", dot: "#0f2a3a"
  },
  sunset: {
    bg1: "#ffedd5", bg2: "#fde2c0", border: "#fcd4b2",
    title: "#7c2d12", label: "#9a3412", accent: "#fb923c", dot: "#f6c49d"
  }
};
THEMES["ayu-light"] = THEMES.ayu_light;
THEMES["default"] = THEMES.default_light;
THEMES["rose_pine_light"] = THEMES.rose_pine;

const THEME = THEMES[SVG_THEME] ?? THEMES.default_light;
const VALUE_COLOR = ACCENT || THEME.accent;

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : String(n));

const card = (title, rows, width = 920) => {
  const pad = 22, th = 30, lh = 34;
  const h = pad + th + 14 + rows.length * lh + pad;

  const estTextWidth = (s, fontSize = 22) =>
    Math.round(String(s).length * (fontSize * 0.62)) + 20;

  const rowsSvg = rows.map((r, i) => {
    const y = pad + th + 14 + (i + 1) * lh;
    const label = r[0], value = r[1];
    const right = width - 24;

    let pill = "";
    if (NUM_STYLE === "pill") {
      const w = estTextWidth(value, 24);
      const x = right - w;
      pill = `<rect x="${x}" y="${y - 24}" width="${w}" height="28" rx="14" ry="14"
                   fill="${VALUE_COLOR}1f" stroke="${VALUE_COLOR}40" />`;
    }

    return `
      <text x="24" y="${y}" font-size="22" fill="${THEME.label}"
            font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">${label}</text>
      ${pill}
      <text x="${right}" y="${y}" text-anchor="end"
            font-family="ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace"
            font-size="24" font-weight="800" fill="${VALUE_COLOR}">${value}</text>
    `;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="${THEME.bg1}"/>
      <stop offset="100%" stop-color="${THEME.bg2}"/>
    </linearGradient>
    <pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.5" fill="${THEME.dot}"/>
    </pattern>
  </defs>

  <rect x="0" y="0" width="${width}" height="${h}" rx="16" ry="16" fill="url(#bg)" stroke="${THEME.border}" />
  <rect x="${width - 420}" y="${pad + th}" width="380" height="${h - pad*2 - th}" fill="url(#dots)" opacity="0.45"/>

  <g transform="translate(${pad},0)">
    <text x="24" y="${pad + th}" font-size="30" font-weight="800" fill="${THEME.title}"
          font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">
      ${title}
    </text>
  </g>

  ${rowsSvg}
</svg>`;
};

try {
  const data = await gql(QUERY, {
    login: GH_LOGIN,
    from: from.toISOString(),
    to: to.toISOString(),
  });

  const u = data.user;
  const cc = u.contributionsCollection;

  // 去重后的 “Contributed to” 仓库数
  const set = new Set();
  for (const x of cc.commitContributionsByRepository) set.add(x.repository.nameWithOwner);
  for (const x of cc.issueContributionsByRepository) set.add(x.repository.nameWithOwner);
  for (const x of cc.pullRequestContributionsByRepository) set.add(x.repository.nameWithOwner);
  const contributedRepos = set.size;

  // streak 计算（过滤未来日期）
  const todayISO = new Date().toISOString().slice(0, 10);
  const days = cc.contributionCalendar.weeks
    .flatMap(w => w.contributionDays)
    .filter(d => d.date <= todayISO)
    .sort((a, b) => a.date.localeCompare(b.date));

  let current = 0, longest = 0, tmp = 0, prev = null;
  for (const d of days) {
    if (prev) {
      const next = new Date(prev);
      next.setUTCDate(next.getUTCDate() + 1);
      const nextISO = next.toISOString().slice(0, 10);
      if (d.date !== nextISO) tmp = 0;
    }
    tmp = d.contributionCount > 0 ? (tmp + 1) : 0;
    if (tmp > longest) longest = tmp;
    prev = d.date;
  }
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) current++;
    else break;
  }

  // stats.svg
  const statsRows = [
    ["Total Stars Earned:",         fmt(u.starredRepositories.totalCount)],
    ["Total Commits (last year):",  fmt(cc.totalCommitContributions)],
    ["Total PRs:",                  fmt(cc.totalPullRequestContributions)],
    ["Total Issues:",               fmt(cc.totalIssueContributions)],
    ["Contributed to (last year):", fmt(contributedRepos)],
  ];
  const statsSVG  = card(`${u.login}'s GitHub Stats`, statsRows, 920);

  // streak.svg
  const streakRows = [
    ["Current Streak (days):", fmt(current)],
    ["Longest Streak (days):", fmt(longest)],
  ];
  const streakSVG = card(`${u.login}'s Contribution Streak`, streakRows, 920);

  // 写入
  const dir = path.join("assets");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "stats.svg"),  statsSVG,  "utf8");
  fs.writeFileSync(path.join(dir, "streak.svg"), streakSVG, "utf8");

  console.log("Wrote assets/stats.svg & assets/streak.svg (theme:", SVG_THEME, "style:", NUM_STYLE, ")");
} catch (e) {
  console.error(e);
  process.exit(1);
}
