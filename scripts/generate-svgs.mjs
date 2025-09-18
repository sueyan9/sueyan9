// scripts/generate-svgs.mjs
// Node 18+ (内置 fetch)。生成 assets/stats.svg 和 assets/streak.svg

import fs from "node:fs";
import path from "node:path";

const GH_LOGIN = process.env.GH_LOGIN || process.env.GITHUB_REPOSITORY?.split("/")[0];
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN || !GH_LOGIN) {
  console.error("Missing env: GITHUB_TOKEN or GH_LOGIN");
  process.exit(1);
}

const graphql = async (query, variables = {}) => {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "stats-svg-action"
    },
    body: JSON.stringify({ query, variables })
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`GraphQL ${r.status}: ${t}`);
  }
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
};

// 时间范围：最近 365 天
const to = new Date();
const from = new Date(to);
from.setUTCDate(from.getUTCDate() - 365);

const Q = /* GraphQL */ `
query($login:String!, $from:DateTime!, $to:DateTime!) {
  user(login:$login) {
    name
    login
    starredRepositories { totalCount }
    contributionsCollection(from:$from, to:$to) {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      repositoriesContributedTo(contributionTypes:[COMMIT,ISSUE,PULL_REQUEST,REPOSITORY]) {
        totalCount
      }
      contributionCalendar {
        weeks {
          contributionDays { date contributionCount }
        }
      }
    }
  }
}`;

const data = await graphql(Q, { login: GH_LOGIN, from: from.toISOString(), to: to.toISOString() });
const u = data.user;
const cc = u.contributionsCollection;

// ---- 计算 streak（到“今天”为止的连续天数 & 历史最长） ----
const todayISO = new Date().toISOString().slice(0, 10);
const days = cc.contributionCalendar.weeks.flatMap(w => w.contributionDays)
  .filter(d => d.date <= todayISO) // 过滤掉未来日期
  .sort((a, b) => a.date.localeCompare(b.date));

let current = 0, longest = 0, tmp = 0;
let prev = null;
for (const d of days) {
  const has = d.contributionCount > 0;
  if (prev) {
    const nextDay = new Date(prev);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextISO = nextDay.toISOString().slice(0,10);
    const contiguous = d.date === nextISO;
    if (!contiguous) tmp = 0; // 断档
  }
  tmp = has ? (tmp + 1) : 0;
  if (tmp > longest) longest = tmp;
  prev = d.date;
}
// 计算“当前连击”：从今天往回数
current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) current++;
  else break;
}

// ---- 生成 SVG（简单卡片风格） ----
const font = `font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial"`;
const card = (title, rows, width = 560) => {
  const lh = 28, pad = 18, th = 26;
  const h = pad + th + 14 + rows.length * lh + pad;
  const rowSvg = rows.map((r, i) =>
    `<text x="20" y="${pad + th + 14 + (i+1)*lh}" ${font} font-size="18">${r[0]}</text>
     <text x="${width-20}" y="${pad + th + 14 + (i+1)*lh}" ${font} font-size="18" font-weight="700" text-anchor="end">${r[1]}</text>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${width}" height="${h}" rx="10" ry="10" fill="#fff" stroke="#e5e7eb"/>
  <text x="20" y="${pad + th}" ${font} font-size="22" font-weight="700">${title}</text>
  ${rowSvg}
</svg>`;
};

// stats.svg
const statsRows = [
  ["Total Stars Earned:", u.starredRepositories.totalCount.toLocaleString()],
  ["Total Commits (last year):", cc.totalCommitContributions.toLocaleString()],
  ["Total PRs:", cc.totalPullRequestContributions.toLocaleString()],
  ["Total Issues:", cc.totalIssueContributions.toLocaleString()],
  ["Contributed to (last year):", cc.repositoriesContributedTo.totalCount.toLocaleString()],
];
const statsSVG = card(`${u.login}'s GitHub Stats`, statsRows);

// streak.svg
const streakRows = [
  ["Current Streak (days):", String(current)],
  ["Longest Streak (days):", String(longest)],
];
const streakSVG = card(`${u.login}'s Contribution Streak`, streakRows);

// 写入
const dir = path.join("assets");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "stats.svg"), statsSVG, "utf8");
fs.writeFileSync(path.join(dir, "streak.svg"), streakSVG, "utf8");

console.log("Wrote assets/stats.svg & assets/streak.svg");
