import type { LeagueFeed } from "./feed-age";

export type GameStatus = "pre" | "in" | "post";

export type GameSide = {
  id: string;
  name: string;
  abbr: string;
  logo: string;
  score?: string;
  winner?: boolean;
  slug?: string;
};

export type GameOdds = {
  provider: string;
  details?: string;
  spread?: string;
  total?: string;
  homeMl?: string;
  awayMl?: string;
  drawMl?: string;
};

export type Game = {
  id: string;
  gameNumber?: number;
  fetchedAt?: string;
  sourceUrl?: string;
  start: string;
  dateKey: string;
  name: string;
  shortName: string;
  sport: string;
  league: string;
  espnLeague: string;
  status: GameStatus;
  statusText: string;
  venue?: string;
  broadcast?: string;
  home: GameSide;
  away: GameSide;
  odds?: GameOdds;
  paSlugs: string[];
  source: "espn" | "mlb" | "desk";
};

export type NewsItem = {
  id: string;
  headline: string;
  description: string;
  published: string;
  href: string;
  image?: string;
  byline?: string;
  teamSlug?: string;
  league?: string;
  source?: string;
};

export type HighlightItem = {
  id: string;
  title: string;
  href: string;
  teamSlug?: string;
  league?: string;
  label: string;
};

export type BuzzItem = {
  id: string;
  title: string;
  href: string;
  updated: string;
  sub: string;
  teamSlug: string;
};

export type TodayBoard = {
  date: string;
  generatedAt: string;
  warnings?: string[];
  feeds?: LeagueFeed[];
  games: Game[];
  upcoming: Game[];
  recent: Game[];
};

export type MonthBoard = {
  month: string;
  generatedAt: string;
  warnings?: string[];
  games: Game[];
};

export type NewsWire = {
  generatedAt: string;
  warnings?: string[];
  articles: NewsItem[];
  buzz: BuzzItem[];
  highlights: HighlightItem[];
};

export type TeamRecord = {
  summary: string;
  standing?: string;
};

export type TeamPageData = {
  slug: string;
  generatedAt: string;
  warnings?: string[];
  games: Game[];
  articles: NewsItem[];
  buzz: BuzzItem[];
  record?: TeamRecord;
  form?: TeamFormRow[];
};

export type TeamFormRow = { result: "W" | "L" | "T"; opponent: string; score: string; dateKey: string };

export type StandingsLeague = "nfl" | "mlb" | "nhl" | "nba" | "cfb" | "cbb";

export type StandingRow = {
  teamId: string;
  slug?: string;
  name: string;
  abbr: string;
  wins: number;
  losses: number;
  ties?: number;
  otl?: number;
  points?: number;
  winPercent: string;
  gamesBehind: string;
  streak: string;
};

export type StandingGroup = { id: string; name: string; rows: StandingRow[] };

export type StandingsBoard = {
  league: StandingsLeague;
  generatedAt: string;
  groups: StandingGroup[];
  seasonLabel?: string;
  seasonNote?: string;
  warnings?: string[];
};
