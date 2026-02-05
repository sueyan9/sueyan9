// scripts/generate-svgs.mjs
// Node 18+ (built-in fetch)
// Generate assets/stats.svg and assets/streak.svg
// Supports theme / accent / number style / stats range / timezone-aware streak

import fs from "node:fs";
import path from "node:path";

// ---------- ENV ----------
const GH_LOGIN =
  process.env.GH_LOGIN ||
  process.env.GITHUB_REPOSITORY_OWNER ||
  (process.env.GITHUB_REPOSITORY
    ? process.env.GITHUB_REPOSITORY.split("/")[0]
    : "") ||
  process.env.GITHUB_ACTOR ||
  "";

const TOKEN =
  process.env.PAT_READ_USER /* prefer PAT for private contributions */ ||
  process.env.GITHUB_TOKEN ||
  process.env.GH_TOKEN;

const SVG_THEME = (process.env.SVG_THEME || "default_light").toLowerCase();
const ACCENT = process.env.ACCENT || "#22d3ee";
const NUM_STYLE = (process.env.NUM_STYLE || "accent").toLowerCase(); // "accent" | "pill"

// NEW:
const STATS_RANGE = (process.env.STATS_RANGE || "last_year").toLowerCase(); // last_year | this_year | all_time
const TZ = process.env.TZ || "Pacific/Auckland"; // e.g. Pacific/Auckland for NZ

if (!TOKEN || !GH_LOGIN) {
  console.error("Missing env: GITHUB_TOKEN/PAT_READ_USER or GH_LOGIN");
  process.exit(1);
}

// ---------- Helpers ----------
const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : String(n));

const todayISOInTZ = (timeZone) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD"

const addDaysISO_UTC = (isoDate, deltaDays) => {
  // isoDate: "YYYY-MM-DD"
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
};

const rangeLabel = (r) => {
  if (r === "this_year") return "this year";
  if (r === "all_time") return "all time";
  return "last year";
};

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

// ---------- Dates ----------
const now = new Date();

// Stats window (configurable)
let statsFrom;
const statsTo = now;

if (STATS_RANGE === "this_year") {
  const y = now.getUTCFullYear();
  statsFrom = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
} else if (STATS_RANGE === "all_time") {
  // keep it early but safe
  statsFrom = new Date(Date.UTC(2008, 0, 1, 0, 0, 0));
} else {
  // last_year default
  statsFrom = new Date(statsTo);
  statsFrom.setUTCDate(statsFrom.getUTCDate() - 365);
}

// Streak window (fixed recent window to keep payload small & streak accurate)
const streakTo = now;
const streakFrom = new Date(streakTo);
streakFrom.setUTCDate(streakFrom.getUTCDate() - 400);

// ---------- Query (two collections via aliases) ----------
const QUERY = /* GraphQL */ `
  query(
    $login: String!
    $statsFrom: DateTime!
    $statsTo: DateTime!
    $streakFrom: DateTime!
    $streakTo: DateTime!
  ) {
    user(login: $login) {
      login
      starredRepositories {
        totalCount
      }

      stats: contributionsCollection(from: $statsFrom, to: $statsTo) {
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
      }

      streak: contributionsCollection(from: $streakFrom, to: $streakTo) {
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
    bg1: "#ffffff",
    bg2: "#f8fafc",
    border: "#e5e7eb",
    title: "#0f172a",
    label: "#475569",
    accent: "#2563eb",
    dot: "#e2e8f0",
  },
  vue: {
    bg1: "#ffffff",
    bg2: "#f2fbf7",
    border: "#d8f3e6",
    title: "#0f3b2e",
    label: "#2b5c45",
    accent: "#41b883",
    dot: "#cce9dd",
  },
  ayu_light: {
    bg1: "#fffaf5",
    bg2: "#faf3ea",
    border: "#eee4d9",
    title: "#1f2430",
    label: "#6c6f93",
    accent: "#ff9940",
    dot: "#e9ded1",
  },
  swift: {
    bg1: "#fff7fb",
    bg2: "#f5f3ff",
    border: "#eadff7",
    title: "#5b21b6",
    label: "#7c3aed",
    accent: "#a855f7",
    dot: "#e9d5ff",
  },
  rose_pine: {
    bg1: "#fffaf3",
    bg2: "#faf4ed",
    border: "#f2e9e1",
    title: "#575279",
    label: "#797593",
    accent: "#b4637a",
    dot: "#eaddcf",
  },
  rose_pine_dawn: {
    bg1: "#fffaf3",
    bg2: "#faf4ed",
    border: "#f2e9e1",
    title: "#575279",
    label: "#797593",
    accent: "#286983",
    dot: "#eaddcf",
  },
  slate: {
    bg1: "#f8fafc",
    bg2: "#eef2f7",
    border: "#e5e7eb",
    title: "#111827",
    label: "#374151",
    accent: "#0ea5e9",
    dot: "#e2e8f0",
  },
  midnight: {
    bg1: "#0f2331",
    bg2: "#0b1622",
    border: "#0b2534",
    title: "#e5f2fb",
    label: "#cbd5e1",
    accent: "#22d3ee",
    dot: "#0f2a3a",
  },
  sunset: {
    bg1: "#ffedd5",
    bg2: "#fde2c0",
    border: "#fcd4b2",
    title: "#7c2d12",
    label: "#9a3412",
    accent: "#fb923c",
    dot: "#f6c49d",
  },
};
THE
