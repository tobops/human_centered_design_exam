/**
 * LeaderBoardModal
 * ----------------
 * Displays the fabricated cohort leaderboard, including hero cards, “chase” banner,
 * and detailed standings table. Uses locally persisted user stats alongside the
 * static opponent blueprint so the UI mirrors the ItemDex styling.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as FileSystem from "expo-file-system/legacy";
import BUNDLED_DEFAULT from "../../user_data.json";

const DATA_PATH =
  `${(FileSystem as any).documentDirectory || (FileSystem as any).cacheDirectory}user_data.json`;

type LeaderboardEntry = {
  id: string;
  name: string;
  points: number;
  streak: number;
  weeklyDelta: number;
  progress: number; // 0 - 1
  isCurrentUser?: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
};

type UserStats = {
  points: number;
  collected: number;
};

const OPPONENTS_BLUEPRINT: Array<
  { id: string; name: string; streak: number; weeklyDelta: number; offset: number }
> = [
  { id: "maya", name: "Maya", offset: 240, streak: 12, weeklyDelta: 120 },
  { id: "leo", name: "Leo", offset: 160, streak: 9, weeklyDelta: 80 },
  { id: "nova", name: "Nova", offset: 80, streak: 6, weeklyDelta: 65 },
  { id: "jo", name: "Jo", offset: 30, streak: 5, weeklyDelta: 42 },
  { id: "amir", name: "Amir", offset: -40, streak: 3, weeklyDelta: 28 },
  { id: "eira", name: "Eira", offset: -90, streak: 5, weeklyDelta: 54 },
  { id: "kai", name: "Kai", offset: -150, streak: 2, weeklyDelta: 18 },
  { id: "sami", name: "Sami", offset: -220, streak: 4, weeklyDelta: 32 },
  { id: "liv", name: "Liv", offset: -280, streak: 1, weeklyDelta: 8 },
];

/**
 * Renders the leaderboard modal, seeding user stats if needed and building
 * synthetic rivals so the user always has someone to chase.
 */
export default function LeaderBoardModal({ visible, onClose }: Props) {
  const [userStats, setUserStats] = useState<UserStats>({
    points: BUNDLED_DEFAULT.points ?? 0,
    collected: BUNDLED_DEFAULT.collected_items?.length ?? 0,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let isMounted = true;

    async function ensureFileExists() {
      try {
        const info = await FileSystem.getInfoAsync(DATA_PATH);
        let needsSeed = !info.exists;

        if (info.exists) {
          try {
            const content = await FileSystem.readAsStringAsync(DATA_PATH, {
              encoding: FileSystem.EncodingType.UTF8,
            });
            const parsed = JSON.parse(content);
            if (!parsed || typeof parsed.points !== "number" || !Array.isArray(parsed.collected_items)) {
              needsSeed = true;
            }
          } catch {
            needsSeed = true;
          }
        }

        if (needsSeed) {
          await FileSystem.writeAsStringAsync(
            DATA_PATH,
            JSON.stringify(BUNDLED_DEFAULT, null, 2),
            { encoding: FileSystem.EncodingType.UTF8 }
          );
        }
      } catch (err) {
        console.error("ensureFileExists failed:", err);
        throw err;
      }
    }

    async function loadUserStats() {
      setLoading(true);
      try {
        await ensureFileExists();
        const content = await FileSystem.readAsStringAsync(DATA_PATH, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const parsed = JSON.parse(content);
        if (isMounted) {
          setUserStats({
            points: parsed.points ?? 0,
            collected: parsed.collected_items?.length ?? 0,
          });
        }
      } catch (err) {
        console.error("Failed loading user stats:", err);
        if (isMounted) {
          setUserStats({
            points: BUNDLED_DEFAULT.points ?? 0,
            collected: BUNDLED_DEFAULT.collected_items?.length ?? 0,
          });
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadUserStats();
    return () => {
      isMounted = false;
    };
  }, [visible]);

  const progressForPoints = (points: number) =>
    Math.min(1, points / 2000);

  const opponents = useMemo<LeaderboardEntry[]>(() => {
    const base = userStats.points || 0;

    return OPPONENTS_BLUEPRINT.map((opponent) => {
      const points = Math.max(0, base + opponent.offset);
      return {
        ...opponent,
        points,
        progress: progressForPoints(points),
      };
    });
  }, [userStats.points]);

  const leaderboard = useMemo<LeaderboardEntry[]>(() => {
    const userEntry: LeaderboardEntry = {
      id: "you",
      name: "You",
      points: userStats.points,
      streak: Math.max(1, Math.round(userStats.collected / 2)),
      weeklyDelta: Math.max(10, userStats.collected * 6),
      progress: progressForPoints(userStats.points),
      isCurrentUser: true,
    };

    return [...opponents, userEntry].sort((a, b) => b.points - a.points);
  }, [opponents, userStats]);

  const userRank = useMemo(() => {
    const idx = leaderboard.findIndex((entry) => entry.isCurrentUser);
    return idx >= 0 ? idx + 1 : null;
  }, [leaderboard]);

  const { nextRival, trailingRival } = useMemo(() => {
    const result: { nextRival: LeaderboardEntry | null; trailingRival: LeaderboardEntry | null } = {
      nextRival: null,
      trailingRival: null,
    };

    if (!leaderboard.length) {
      return result;
    }

    const userIndex = leaderboard.findIndex((entry) => entry.isCurrentUser);
    if (userIndex === -1) {
      return result;
    }

    result.nextRival = userIndex > 0 ? leaderboard[userIndex - 1] : null;
    result.trailingRival = userIndex < leaderboard.length - 1 ? leaderboard[userIndex + 1] : null;

    return result;
  }, [leaderboard]);

  const hasLeaderAbove = Boolean(nextRival && !nextRival.isCurrentUser);

  const bannerTitle = hasLeaderAbove
    ? `Jag ${nextRival!.name}`
    : trailingRival
    ? `Hold bort ${trailingRival.name}`
    : "Du leder!";

  const bannerText = hasLeaderAbove
    ? `Tjen ${Math.max(1, nextRival!.points - userStats.points)} mer poeng for å overta.`
    : trailingRival
    ? `${Math.max(1, userStats.points - trailingRival.points)} poeng foran nå.`
    : "Fortsett å samle for å ta igjen ledelsen.";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Ledertavle</Text>
              <Text style={styles.subtitle}>Samle objekter og overta andre spillere!</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeTxt}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.statWrap}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Din Rang</Text>
              <Text style={styles.statValue}>
                {userRank ? `#${userRank}` : loading ? "…" : "-"}
              </Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Poeng Totalt</Text>
              <Text style={styles.statValue}>
                {loading ? "…" : userStats.points}
              </Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Neste Rival</Text>
              <Text style={styles.statValue}>
                {nextRival
                  ? `${nextRival.name}`
                  : "None"}
              </Text>
              {nextRival && (
                <Text style={styles.statHint}>
                  {nextRival.points >= userStats.points
                    ? `+${nextRival.points - userStats.points} pts`
                    : `-${userStats.points - nextRival.points} pts`}
                </Text>
              )}
            </View>
          </View>

          <View style={styles.progressBanner}>
            <View style={styles.bannerLeft}>
              <FontAwesome name={nextRival ? "rocket" : "trophy"} size={20} color="#4ade80" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>{bannerTitle}</Text>
              <Text style={styles.bannerText}>{bannerText}</Text>
            </View>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.list}>
              {leaderboard.map((entry, index) => {
                const isTopThree = index < 3;
                const isCurrent = Boolean(entry.isCurrentUser);
                const deltaIcon =
                  entry.weeklyDelta > 0
                    ? "arrow-up"
                    : entry.weeklyDelta < 0
                    ? "arrow-down"
                    : "minus";

                return (
                  <View
                    key={`${entry.id}-card`}
                    style={[
                      styles.row,
                      isTopThree && styles.rowHighlight,
                      isCurrent && styles.rowCurrent,
                    ]}
                  >
                    <View style={[styles.rankBadge, isTopThree && styles.rankBadgeTop]}>
                      <Text style={styles.rankText}>#{index + 1}</Text>
                    </View>
                    <View style={styles.rowBody}>
                      <View style={styles.rowHeader}>
                        <Text style={styles.name}>{entry.name}</Text>
                        <View style={styles.badgeRow}>
                          {isCurrent && (
                            <View style={styles.youBadge}>
                              <Text style={styles.youBadgeText}>YOU</Text>
                            </View>
                          )}
                          {isTopThree && (
                            <FontAwesome
                              name="trophy"
                              size={14}
                              color="#fbbf24"
                              style={{ marginLeft: 8 }}
                            />
                          )}
                        </View>
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={styles.pointsText}>{entry.points} pts</Text>
                        <View style={styles.metaChip}>
                          <FontAwesome name="fire" size={12} color="#fb7185" />
                          <Text style={styles.metaChipText}>{entry.streak}-dag streak</Text>
                        </View>
                        <View style={styles.metaChip}>
                          <FontAwesome
                            name={deltaIcon as any}
                            size={12}
                            color={
                              entry.weeklyDelta > 0
                                ? "#4ade80"
                                : entry.weeklyDelta < 0
                                ? "#f87171"
                                : "#facc15"
                            }
                          />
                          <Text style={styles.metaChipText}>
                            {entry.weeklyDelta > 0 ? "+" : ""}
                            {entry.weeklyDelta} pts
                          </Text>
                        </View>
                      </View>

                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${Math.min(100, entry.progress * 100)}%` },
                          ]}
                        />
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>

            <View style={styles.tableSection}>
              <Text style={styles.tableTitle}>Full Tabell</Text>
              <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeader]}>
                  <Text style={[styles.tableCell, styles.tableCellRank]}>Rang</Text>
                  <Text style={[styles.tableCell, styles.tableCellName]}>Spiller</Text>
                  <Text style={[styles.tableCell, styles.tableCellPoints]}>Poeng</Text>
                  <Text style={[styles.tableCell, styles.tableCellStreak]}>Streak</Text>
                  <Text style={[styles.tableCell, styles.tableCellDelta]}>Δ Uke</Text>
                </View>
                {leaderboard.map((entry, index) => (
                  <View
                    key={`${entry.id}-row`}
                    style={[
                      styles.tableRow,
                      entry.isCurrentUser && styles.tableRowCurrent,
                    ]}
                  >
                    <Text style={[styles.tableCell, styles.tableCellRank]}>#{index + 1}</Text>
                    <Text
                      style={[
                        styles.tableCell,
                        styles.tableCellName,
                        entry.isCurrentUser && styles.tableCellYou,
                      ]}
                    >
                      {entry.name}
                    </Text>
                    <Text style={[styles.tableCell, styles.tableCellPoints]}>
                      {entry.points}
                    </Text>
                    <Text style={[styles.tableCell, styles.tableCellStreak]}>
                      {entry.streak}d
                    </Text>
                    <Text
                      style={[
                        styles.tableCell,
                        styles.tableCellDelta,
                        entry.weeklyDelta > 0
                          ? styles.tableCellDeltaPositive
                          : entry.weeklyDelta < 0
                          ? styles.tableCellDeltaNegative
                          : undefined,
                      ]}
                    >
                      {entry.weeklyDelta > 0 ? "+" : ""}
                      {entry.weeklyDelta}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "rgba(12,12,12,0.96)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
    height: "88%",
    maxHeight: "88%",
    width: "100%",
    alignSelf: "stretch",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  subtitle: {
    color: "#9ca3af",
    fontSize: 13,
    marginTop: 4,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  closeTxt: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  statWrap: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  statCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginHorizontal: 4,
  },
  statLabel: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  statValue: {
    color: "#f9fafb",
    fontSize: 20,
    fontWeight: "700",
    marginTop: 6,
  },
  statHint: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  progressBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(74,222,128,0.12)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.2)",
    padding: 14,
    marginBottom: 20,
  },
  bannerLeft: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(74,222,128,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  bannerTitle: {
    color: "#ecfccb",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  bannerText: {
    color: "#bbf7d0",
    fontSize: 13,
    lineHeight: 18,
  },
  list: {
    gap: 10,
    paddingBottom: 20,
  },
  scrollContent: {
    paddingBottom: 32,
    paddingTop: 4,
  },
  row: {
    flexDirection: "row",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 12,
  },
  rowHighlight: {
    borderColor: "rgba(251,191,36,0.4)",
    backgroundColor: "rgba(251,191,36,0.12)",
  },
  rowCurrent: {
    borderColor: "rgba(59,130,246,0.6)",
    backgroundColor: "rgba(59,130,246,0.2)",
  },
  rankBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  rankBadgeTop: {
    backgroundColor: "rgba(251,191,36,0.18)",
    borderColor: "rgba(251,191,36,0.45)",
  },
  rankText: {
    color: "#f9fafb",
    fontWeight: "800",
    fontSize: 16,
  },
  rowBody: {
    flex: 1,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  name: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  youBadge: {
    backgroundColor: "rgba(59,130,246,0.18)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.5)",
  },
  youBadgeText: {
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  levelText: {
    color: "#cbd5f5",
    fontSize: 13,
    marginTop: 2,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  pointsText: {
    color: "#f9fafb",
    fontWeight: "700",
    fontSize: 14,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  metaChipText: {
    color: "#e5e7eb",
    fontSize: 12,
    fontWeight: "600",
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#3b82f6",
  },
  tableSection: {
    marginTop: 24,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 16,
  },
  tableTitle: {
    color: "#e5e7eb",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 12,
  },
  table: {
    borderRadius: 12,
    overflow: "hidden",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  tableHeader: {
    backgroundColor: "rgba(59,130,246,0.16)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(59,130,246,0.3)",
  },
  tableRowCurrent: {
    backgroundColor: "rgba(59,130,246,0.12)",
  },
  tableCell: {
    color: "#f3f4f6",
    fontSize: 13,
    fontWeight: "600",
  },
  tableCellRank: {
    flex: 1,
  },
  tableCellPoints: {
    flex: 2,
    textAlign: "right",
  },
  tableCellStreak: {
    flex: 2,
    textAlign: "right",
  },
  tableCellDelta: {
    flex: 2,
    textAlign: "right",
  },
  tableCellYou: {
    color: "#93c5fd",
  },
  tableCellDeltaPositive: {
    color: "#4ade80",
  },
  tableCellDeltaNegative: {
    color: "#f87171",
  },
});
