// scripts/generate-svgs.mjs
// Node 18+（内置 fetch）
// 生成 assets/stats.svg 与 assets/streak.svg，并支持主题样式

import fs from "node:fs";
import path from "node:path";

// ----------- ENV -----------
const GH_LOGIN =
  process.env.GH_LOGIN ||
  process.env.GITHUB_REPOSITORY?.split("/")[0] ||
  "";

const TOKEN =
  process.env.PAT_READ_USER /* 优先用 PAT（可读私有贡献）*/ ||
  process.env.GITHUB_TOKEN;  /* 回退到 Actions 的 token */

const SVG_THEME = (process.env.SVG_THEME || "slate").toLowerCase();

if (!TOKEN || !GH_LOGIN) {
  console.error("Missing env: GITHUB_TOKEN/PAT_READ_USER or GH_LOGIN");
  process.exit(1);
}

// ----------- GraphQL helper -----------
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

// 最近 365 天
const to = new Date();
const from = new Date(to);
from.setUTCDate(from.getUTCDate() - 365);

// ----------- Query -----------
// 注意：maxRepositories 上限 100（官方限制）
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

// ----------- 主题样式 -----------
const THEMES = {
  slate: {
    bg: "#ffffff",
    border: "#e5e7eb",
    title: "#111827",
    label: "#374151",
    value: "#0b1220",
    accent: "#0ea5e9",
  },
  midnight: {
    bg: "#0b1220",
    border: "#1f2937",
    title: "#e5e7eb",
    label: "#94a3b8",
    value: "#ffffff",
    accent: "#22d3ee",
  },
  sunset: {
    bg: "#fff7ed",
    border: "#fed7aa",
    title: "#7c2d12",
    label: "#9a3412",
    value: "#7c2d12",
    accent: "#fb923c",
  },
};
const THEME = THEMES[SVG_THEME] ?? THEMES.slate;
const font = `font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial"`;

// 卡片渲染（带渐变/点阵装饰）
function card(title, rows, width = 560, icon = "📊") {
  const lh = 28, pad = 18, th = 26;
  const h  = pad + th + 14 + rows.length * lh + pad;

  const rowsSvg = rows.map((r, i) => {
    const y = pad + th + 14 + (i + 1) * lh;
    return `
      <text x="20" y="${y}" ${font} font-size="17" fill="${THEME.label}">${r[0]}</text>
      <text x="${width - 20}" y="${y}" ${font} font-size="18" font-weight="700"
            text-anchor="end" fill="${THEME.value}">${r[1]}</text>
    `;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${h}" viewBox="0 0 ${width} ${h}"
     xmlns="http://www.w3.org/2000/svg" role="img">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${THEME.accent}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${THEME.accent}" stop-opacity="0"/>
    </linearGradient>
    <pattern id="dots" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="1" fill="${THEME.accent}" opacity="0.25"/>
    </pattern>
  </defs>

  <rect x="0.5" y="0.5" width="${width-1}" height="${h-1}" rx="12" ry="12"
        fill="${THEME.bg}" stroke="${THEME.border}"/>

  <rect x="0" y="0" width="${width}" height="${Math.min(110,h)}" fill="url(#g)"/>
  <rect x="${width-140}" y="${h-70}" width="130" height="60" fill="url(#dots)" opacity="0.35"/>

  <text x="20" y="${pad + th}" ${font} font-size="22" font-weight="800" fill="${THEME.title}">
    ${icon} ${title}
  </text>

  ${rowsSvg}
</svg>`;
}

const fmt = (n) =>
  (typeof n === "number")
    ? n.toLocaleString("en-US")
    : String(n);

// ----------- 拉数据 & 生成 SVG -----------
try {
  const data = await gql(QUERY, {
    login: GH_LOGIN,
    from: from.toISOString(),
    to: to.toISOString(),
  });

  const u = data.user;
  const cc = u.contributionsCollection;

  // 计算 “Contributed to” 的仓库数（去重）
  const set = new Set();
  for (const x of cc.commitContributionsByRepository) set.add(x.repository.nameWithOwner);
  for (const x of cc.issueContributionsByRepository) set.add(x.repository.nameWithOwner);
  for (const x of cc.pullRequestContributionsByRepository) set.add(x.repository.nameWithOwner);
  const contributedRepos = set.size;

  // 计算 streak（到今天为止）
  const days = cc.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date));

  let current = 0, longest = 0, tmp = 0, prev = null;
  for (const d of days) {
    if (prev) {
      const next = new Date(prev);
      next.setUTCDate(next.getUTCDate() + 1);
      const nextISO = next.toISOString().slice(0, 10);
      if (d.date !== nextISO) tmp = 0; // 断档
    }
    tmp = d.contributionCount > 0 ? (tmp + 1) : 0;
    if (tmp > longest) longest = tmp;
    prev = d.date;
  }
  // 当前 streak：从末尾往回数
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) current++;
    else break;
  }

  // ------- stats.svg -------
  const statsRows = [
    ["Total Stars Earned:", fmt(u.starredRepositories.totalCount)],
    ["Total Commits (last year):", fmt(cc.totalCommitContributions)],
    ["Total PRs:", fmt(cc.totalPullRequestContributions)],
    ["Total Issues:", fmt(cc.totalIssueContributions)],
    ["Contributed to (last year):", fmt(contributedRepos)],
  ];
  const statsSVG  = card(`${u.login}'s GitHub Stats`, statsRows, 560, "📈");

  // ------- streak.svg -------
  const streakRows = [
    ["Current Streak (days):", fmt(current)],
    ["Longest Streak (days):", fmt(longest)],
  ];
  const streakSVG = card(`${u.login}'s Contribution Streak`, streakRows, 560, "🔥");

  // 写入
  const dir = path.join("assets");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "stats.svg"),  statsSVG,  "utf8");
  fs.writeFileSync(path.join(dir, "streak.svg"), streakSVG, "utf8");

  console.log("Wrote assets/stats.svg & assets/streak.svg (theme:", SVG_THEME, ")");
} catch (e) {
  console.error(e);
  process.exit(1);
}
