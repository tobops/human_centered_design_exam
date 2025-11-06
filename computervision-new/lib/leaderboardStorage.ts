/* #######################################  IMPORTS  ####################################### */

import * as FileSystem from "expo-file-system/legacy";
import LEADERBOARD_DEFAULT from "../leaderboard_data.json";

/* #######################################  TYPES  ####################################### */

export type LeaderboardPlayer = {
  id: string;
  name: string;
  points: number;
  streak: number;
  weeklyDelta: number;
};

type LeaderboardData = {
  players: LeaderboardPlayer[];
};

/* #######################################  CONSTANTS  ####################################### */

const LEADERBOARD_PATH =
  `${(FileSystem as any).documentDirectory || (FileSystem as any).cacheDirectory}leaderboard_data.json`;

/* #######################################  HELPERS  ####################################### */

/**
 * Ensures every player object has sane defaults so other consumers do not
 * have to guard against missing properties.
 */
function sanitizePlayer(raw: any): LeaderboardPlayer {
  return {
    id: String(raw?.id ?? ""),
    name: String(raw?.name ?? ""),
    points: typeof raw?.points === "number" ? raw.points : 0,
    streak: typeof raw?.streak === "number" ? raw.streak : 0,
    weeklyDelta: typeof raw?.weeklyDelta === "number" ? raw.weeklyDelta : 0,
  };
}

/**
 * Returns a deep copy of the bundled leaderboard so we never mutate the import.
 */
function cloneDefaultLeaderboard(): LeaderboardData {
  const players = Array.isArray(LEADERBOARD_DEFAULT?.players)
    ? LEADERBOARD_DEFAULT.players
    : [];
  return {
    players: players.map(sanitizePlayer),
  };
}

/**
 * Persists leaderboard data to the Expo sandbox in a pretty JSON format.
 */
async function writeLeaderboardData(data: LeaderboardData) {
  await FileSystem.writeAsStringAsync(
    LEADERBOARD_PATH,
    JSON.stringify({ players: data.players }, null, 2),
    { encoding: FileSystem.EncodingType.UTF8 }
  );
}

/**
 * Reads whatever data currently lives on disk, or falls back to an empty array.
 */
async function readExistingFile(): Promise<LeaderboardData> {
  try {
    const info = await FileSystem.getInfoAsync(LEADERBOARD_PATH);
    if (!info.exists) {
      return { players: [] };
    }
    const content = await FileSystem.readAsStringAsync(LEADERBOARD_PATH, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const parsed = JSON.parse(content);
    const players = Array.isArray(parsed?.players) ? parsed.players : [];
    return { players: players.map(sanitizePlayer) };
  } catch (err) {
    console.error("Failed to read existing leaderboard file:", err);
    return { players: [] };
  }
}

/* #######################################  PUBLIC API  ####################################### */

/**
 * Ensures a leaderboard file exists by merging the bundled defaults with whatever
 * is already stored. The current user keeps their persisted stats, and any runtime
 * rivals are carried forward.
 */
export async function ensureLeaderboardFile(): Promise<LeaderboardData> {
  const defaults = cloneDefaultLeaderboard();
  const existing = await readExistingFile();

  const existingMap = new Map(
    existing.players.map((p) => [p.id, sanitizePlayer(p)])
  );

  const merged: LeaderboardPlayer[] = defaults.players.map((player) => {
    const stored = existingMap.get(player.id);
    if (player.id === "you" && stored) {
      return {
        ...player,
        points: stored.points,
        streak: stored.streak,
        weeklyDelta: stored.weeklyDelta,
      };
    }
    return player;
  });

  // Carry over any rivals that are not part of the bundled defaults.
  existing.players.forEach((player) => {
    if (!merged.some((p) => p.id === player.id)) {
      merged.push(player);
    }
  });

  await writeLeaderboardData({ players: merged });
  return { players: merged };
}

/**
 * Reads the leaderboard roster, guaranteeing the file structure first.
 */
export async function readLeaderboardData(): Promise<LeaderboardPlayer[]> {
  const ensured = await ensureLeaderboardFile();
  return ensured.players;
}

/**
 * Updates the "you" entry with fresh stats while leaving other rivals untouched.
 */
export async function setUserLeaderboardStats(stats: {
  points: number;
  streak?: number;
  weeklyDelta?: number;
}) {
  const data = await ensureLeaderboardFile();
  const updatedPlayers = data.players.map((player) =>
    player.id === "you"
      ? {
          ...player,
          points: stats.points,
          streak:
            typeof stats.streak === "number" ? stats.streak : player.streak,
          weeklyDelta:
            typeof stats.weeklyDelta === "number"
              ? stats.weeklyDelta
              : player.weeklyDelta,
        }
      : player
  );

  await writeLeaderboardData({ players: updatedPlayers });
}
