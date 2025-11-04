import React, { useEffect, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import FontAwesome from '@expo/vector-icons/FontAwesome';
// Use legacy API to avoid SDK 54 deprecation warnings quickly
import * as FileSystem from "expo-file-system/legacy";
// Import the bundled JSON from project root
import BUNDLED_DEFAULT from "../../user_data.json";
import { flagFor } from "../flags";

const DATA_PATH =
  `${(FileSystem as any).documentDirectory || (FileSystem as any).cacheDirectory}user_data.json`;

type CollectedItem = {
  id: string;
  label_NO: string;
  label_TRANS: string;
  desc_NO: string;
  desc_TRANS: string;
  grammar_NO: string;
  collected_at: string; // ISO string
  isFavorite?: boolean;
  level?: string; // A1, A2, B1, B2
  viewed?: boolean; // Track if user has seen this item
  targetLang?: string; // Language code (en, es, etc.)
};

type UserData = {
  points: number;
  collected_items: CollectedItem[];
};

type SortOption = "date" | "alphabetical" | "level" | "favorites";

type Props = {
  visible: boolean;
  onClose: () => void;
  speak?: (text: string, lang: string) => void;
};

export default function ItemDexModal({ visible, onClose, speak }: Props) {
  const [data, setData] = useState<UserData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("date");
  const [showSortMenu, setShowSortMenu] = useState(false);

  useEffect(() => {
    if (!visible) return;
    loadUserData();
    setExpandedId(null); // Reset expanded item when modal opens
    markAllAsViewed(); // Mark all items as viewed when modal opens
  }, [visible]);

  async function markAllAsViewed() {
    try {
      // Wait a bit for data to load
      setTimeout(async () => {
        if (!data) return;

        // Mark all items as viewed
        const updatedItems = data.collected_items.map(item => ({
          ...item,
          viewed: true
        }));

        const updatedData = { ...data, collected_items: updatedItems };
        setData(updatedData);

        // Save to file
        await FileSystem.writeAsStringAsync(
          DATA_PATH,
          JSON.stringify(updatedData, null, 2),
          { encoding: FileSystem.EncodingType.UTF8 }
        );

        console.log("✅ Marked all items as viewed");
      }, 500);
    } catch (err) {
      console.error("❌ Error marking items as viewed:", err);
    }
  }

  // Seed into sandbox if missing or empty
  async function ensureFileExists() {
    try {
      console.log("🔍 Checking if file exists at:", DATA_PATH);
      const info = await FileSystem.getInfoAsync(DATA_PATH);

      let needsReseed = false;

      if (!info.exists) {
        console.log("📝 File doesn't exist, will create...");
        needsReseed = true;
      } else {
        // Check if file has valid content
        console.log("✅ File exists, checking content...");
        const content = await FileSystem.readAsStringAsync(DATA_PATH, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        try {
          const parsed: UserData = JSON.parse(content);
          // Reseed if empty OR if items don't have required fields (old data format)
          const hasLevelField = parsed.collected_items?.some((item: any) => item.level);
          const hasViewedField = parsed.collected_items?.some((item: any) => item.hasOwnProperty('viewed'));
          const hasTargetLangField = parsed.collected_items?.some((item: any) => item.targetLang);
          if (!parsed.collected_items || parsed.collected_items.length < 10 || !hasLevelField || !hasViewedField || !hasTargetLangField) {
            console.log(`⚠️ File has ${parsed.collected_items?.length || 0} items, need 10 with all fields. Reseeding...`);
            needsReseed = true;
          } else {
            console.log(`✅ File has ${parsed.collected_items.length} items`);
          }
        } catch {
          console.log("⚠️ File exists but is invalid JSON, reseeding...");
          needsReseed = true;
        }
      }

      if (needsReseed) {
        console.log("📝 Writing default data to file...");
        await FileSystem.writeAsStringAsync(
          DATA_PATH,
          JSON.stringify(BUNDLED_DEFAULT, null, 2),
          { encoding: FileSystem.EncodingType.UTF8 }
        );
        console.log("✅ Default file created successfully with", BUNDLED_DEFAULT.collected_items.length, "items");
      }
    } catch (err: any) {
      console.error("❌ Error in ensureFileExists:", err);
      throw err;
    }
  }

  async function loadUserData() {
    try {
      console.log("📂 Starting loadUserData...");
      console.log("📍 DATA_PATH:", DATA_PATH);

      await ensureFileExists();
      console.log("✅ File existence ensured");

      const content = await FileSystem.readAsStringAsync(DATA_PATH, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      console.log("📄 Raw JSON length:", content.length);

      const parsed: UserData = JSON.parse(content);
      console.log("✅ Parsed items:", parsed.collected_items?.length ?? 0);

      setData(parsed);
      setError(null);
    } catch (err: any) {
      console.error("❌ Failed reading user_data.json:", err);
      console.error("Error details:", err.message || err);

      // Fallback to default data instead of showing error
      console.log("⚠️ Using fallback default data");
      setData(BUNDLED_DEFAULT);
      setError(null);
    }
  }

  async function toggleFavorite(itemId: string) {
    try {
      if (!data) return;

      // Update local state
      const updatedItems = data.collected_items.map(item =>
        item.id === itemId ? { ...item, isFavorite: !item.isFavorite } : item
      );

      const updatedData = { ...data, collected_items: updatedItems };
      setData(updatedData);

      // Save to file
      await FileSystem.writeAsStringAsync(
        DATA_PATH,
        JSON.stringify(updatedData, null, 2),
        { encoding: FileSystem.EncodingType.UTF8 }
      );

      console.log(`⭐ Toggled favorite for item: ${itemId}`);
    } catch (err) {
      console.error("❌ Error toggling favorite:", err);
    }
  }

  function getSortedItems(items: CollectedItem[]): CollectedItem[] {
    const sorted = [...items];

    switch (sortBy) {
      case "alphabetical":
        return sorted.sort((a, b) => a.label_NO.localeCompare(b.label_NO));

      case "level":
        const levelOrder = { "A1": 1, "A2": 2, "B1": 3, "B2": 4 };
        return sorted.sort((a, b) => {
          const aLevel = levelOrder[a.level as keyof typeof levelOrder] || 0;
          const bLevel = levelOrder[b.level as keyof typeof levelOrder] || 0;
          return aLevel - bLevel;
        });

      case "favorites":
        return sorted.sort((a, b) => {
          // Favorites first
          if (a.isFavorite && !b.isFavorite) return -1;
          if (!a.isFavorite && b.isFavorite) return 1;
          // Then by date
          return new Date(b.collected_at).getTime() - new Date(a.collected_at).getTime();
        });

      case "date":
      default:
        return sorted.sort((a, b) =>
          new Date(b.collected_at).getTime() - new Date(a.collected_at).getTime()
        );
    }
  }


  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>ItemDex</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeTxt}>✕</Text>
            </Pressable>
          </View>

          {error && <Text style={styles.errorTxt}>{error}</Text>}
          {!error && !data && <Text style={styles.bodyTxt}>Loading…</Text>}

          {!error && data && (
            <>
              {/* Progress Bar & Stats */}
              <View style={styles.statsContainer}>
                <View style={styles.statsRow}>
                  <Text style={styles.points}>
                    <FontAwesome name="star" size={16} color="#fbbf24" /> {data.points} Points
                  </Text>
                  <Text style={styles.collectionCount}>
                    {data.collected_items.length} Items
                  </Text>
                </View>
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${Math.min(100, (data.collected_items.length / 50) * 100)}%` }
                    ]}
                  />
                </View>
                <Text style={styles.progressText}>
                  {data.collected_items.length}/50 collected
                </Text>
              </View>

              {/* Sort Button */}
              <View style={styles.sortContainer}>
                {/* Backdrop to close dropdown when clicking outside */}
                {showSortMenu && (
                  <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={() => setShowSortMenu(false)}
                  />
                )}

                <Pressable
                  style={styles.sortButton}
                  onPress={() => setShowSortMenu(!showSortMenu)}
                >
                  <FontAwesome name="sort" size={14} color="#fff" />
                  <Text style={styles.sortButtonText}>
                    {sortBy === "date" ? "Date" : sortBy === "alphabetical" ? "A-Z" : sortBy === "level" ? "Level" : "Favorites"}
                  </Text>
                  <FontAwesome name={showSortMenu ? "chevron-up" : "chevron-down"} size={12} color="#fff" />
                </Pressable>

                {/* Sort Dropdown */}
                {showSortMenu && (
                  <View style={styles.sortDropdown}>
                    <Pressable
                      style={[styles.sortOption, sortBy === "date" && styles.sortOptionActive]}
                      onPress={() => { setSortBy("date"); setShowSortMenu(false); }}
                    >
                      <FontAwesome name="calendar" size={14} color="#fff" />
                      <Text style={styles.sortOptionText}>Date Added</Text>
                      {sortBy === "date" && <FontAwesome name="check" size={14} color="#4ade80" />}
                    </Pressable>
                    <Pressable
                      style={[styles.sortOption, sortBy === "alphabetical" && styles.sortOptionActive]}
                      onPress={() => { setSortBy("alphabetical"); setShowSortMenu(false); }}
                    >
                      <FontAwesome name="sort-alpha-asc" size={14} color="#fff" />
                      <Text style={styles.sortOptionText}>Alphabetical</Text>
                      {sortBy === "alphabetical" && <FontAwesome name="check" size={14} color="#4ade80" />}
                    </Pressable>
                    <Pressable
                      style={[styles.sortOption, sortBy === "level" && styles.sortOptionActive]}
                      onPress={() => { setSortBy("level"); setShowSortMenu(false); }}
                    >
                      <FontAwesome name="signal" size={14} color="#fff" />
                      <Text style={styles.sortOptionText}>Difficulty</Text>
                      {sortBy === "level" && <FontAwesome name="check" size={14} color="#4ade80" />}
                    </Pressable>
                    <Pressable
                      style={[styles.sortOption, sortBy === "favorites" && styles.sortOptionActive]}
                      onPress={() => { setSortBy("favorites"); setShowSortMenu(false); }}
                    >
                      <FontAwesome name="star" size={14} color="#fbbf24" />
                      <Text style={styles.sortOptionText}>Favorites</Text>
                      {sortBy === "favorites" && <FontAwesome name="check" size={14} color="#4ade80" />}
                    </Pressable>
                  </View>
                )}
              </View>

              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {data.collected_items.length === 0 ? (
                  <Text style={styles.bodyTxt}>No items collected yet.</Text>
                ) : (
                  <View style={styles.grid}>
                    {getSortedItems(data.collected_items).map((item) => {
                      const isExpanded = expandedId === item.id;
                      const isNew = !item.viewed; // Show NEW badge only for unviewed items
                      const levelColor = item.level === "A1" ? "#4ade80" : item.level === "A2" ? "#60a5fa" : item.level === "B1" ? "#fbbf24" : "#f87171";

                      return (
                        <Pressable
                          key={item.id}
                          style={[
                            styles.gridItem,
                            isExpanded && styles.gridItemExpanded,
                            item.level && { borderColor: levelColor }
                          ]}
                          onPress={() => setExpandedId(isExpanded ? null : item.id)}
                        >
                          {/* Status Badge */}
                          {isNew && !isExpanded && (
                            <View style={styles.badge}>
                              <Text style={styles.badgeText}>NEW</Text>
                            </View>
                          )}

                          {/* Favorite Star (top right) */}
                          {!isExpanded && item.isFavorite && (
                            <View style={styles.favoriteCorner}>
                              <FontAwesome name="star" size={12} color="#fbbf24" />
                            </View>
                          )}

                          <Text style={styles.itemLabel}>{item.label_NO}</Text>

                          {isExpanded && (
                            <View style={styles.expandedContent}>
                              {/* Close Button */}
                              <Pressable
                                style={styles.closeExpandedBtn}
                                onPress={() => setExpandedId(null)}
                              >
                                <FontAwesome name="times" size={18} color="#fff" />
                              </Pressable>

                              {/* Row with Favorite and Language */}
                              <View style={styles.topRow}>
                                <Pressable
                                  style={styles.favoriteButton}
                                  onPress={() => toggleFavorite(item.id)}
                                >
                                  <FontAwesome
                                    name={item.isFavorite ? "star" : "star-o"}
                                    size={18}
                                    color="#fbbf24"
                                  />
                                  <Text style={styles.favoriteButtonText}>
                                    {item.isFavorite ? "Favorited" : "Favorite"}
                                  </Text>
                                </Pressable>

                                {/* Language Flag */}
                                {item.targetLang && (
                                  <View style={styles.languageFlag}>
                                    <Text style={styles.languageFlagText}>
                                      {flagFor(item.targetLang)}
                                    </Text>
                                  </View>
                                )}
                              </View>

                              {/* Tappable Norwegian Word with TTS */}
                              <Pressable
                                onPress={() => speak && speak(item.label_NO, "no")}
                                style={styles.ttsWordButton}
                              >
                                <Text style={styles.ttsWord}>{item.label_NO}</Text>
                                <FontAwesome name="volume-up" size={16} color="#4ade80" />
                              </Pressable>

                              <Text style={styles.translation}>→ {item.label_TRANS}</Text>

                              {/* Tappable Norwegian Description with TTS */}
                              <Pressable
                                onPress={() => speak && speak(item.desc_NO, "no")}
                                style={styles.ttsDescButton}
                              >
                                <Text style={styles.desc}>{item.desc_NO}</Text>
                                <FontAwesome name="volume-up" size={14} color="#93c5fd" />
                              </Pressable>

                              <Text style={styles.descTrans}>{item.desc_TRANS}</Text>
                              <Text style={styles.grammar}>{item.grammar_NO}</Text>

                              {/* Level Badge */}
                              {item.level && (
                                <View style={[styles.levelBadge, { backgroundColor: levelColor }]}>
                                  <Text style={styles.levelBadgeText}>{item.level}</Text>
                                </View>
                              )}

                              <Text style={styles.date}>
                                🕓 {new Date(item.collected_at).toLocaleString("no-NO")}
                              </Text>
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20
  },
  sheet: {
    backgroundColor: "#0b0b0b",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    width: "100%",
    height: "85%",
    maxHeight: "85%"
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16
  },
  title: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    flex: 1,
    letterSpacing: 0.5
  },
  closeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 8
  },
  closeTxt: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700"
  },

  // Stats & Progress
  statsContainer: {
    marginBottom: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)"
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8
  },
  points: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15
  },
  collectionCount: {
    color: "#bbb",
    fontSize: 14,
    fontWeight: "600"
  },
  progressBarBg: {
    height: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 6
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#4ade80",
    borderRadius: 4
  },
  progressText: {
    color: "#888",
    fontSize: 12,
    textAlign: "center"
  },

  // Sort
  sortContainer: {
    marginBottom: 12,
    zIndex: 10
  },
  sortButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
    alignSelf: "flex-start"
  },
  sortButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600"
  },
  sortDropdown: {
    position: "absolute",
    top: 40,
    left: 0,
    backgroundColor: "rgba(20,20,20,0.98)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    paddingVertical: 6,
    minWidth: 180,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 10
  },
  sortOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10
  },
  sortOptionActive: {
    backgroundColor: "rgba(74,222,128,0.1)"
  },
  sortOptionText: {
    color: "#fff",
    fontSize: 14,
    flex: 1
  },

  // Grid
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-start",
    paddingBottom: 20
  },
  gridItem: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 12,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.12)",
    minWidth: "30%",
    flexBasis: "30%",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 60,
    position: "relative"
  },
  gridItemExpanded: {
    flexBasis: "100%",
    minWidth: "100%",
    alignItems: "flex-start",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.2)"
  },
  itemLabel: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center"
  },

  // Badges
  badge: {
    position: "absolute",
    top: -4,
    left: -4,
    backgroundColor: "#4ade80",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6
  },
  badgeText: {
    color: "#000",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5
  },
  favoriteCorner: {
    position: "absolute",
    top: 4,
    right: 4
  },

  // Expanded Content
  expandedContent: {
    marginTop: 12,
    width: "100%",
    position: "relative"
  },
  closeExpandedBtn: {
    position: "absolute",
    top: -36,
    right: 3,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 20,
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
    borderWidth: 2,
    borderColor: "rgba(0,0,0,0.4)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    marginTop: 8,
    gap: 8
  },
  favoriteButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(251,191,36,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.3)",
    flex: 1
  },
  favoriteButtonText: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "600"
  },
  languageFlag: {
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)"
  },
  languageFlagText: {
    fontSize: 20
  },
  ttsWordButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(74,222,128,0.1)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.3)"
  },
  ttsWord: {
    color: "#4ade80",
    fontSize: 18,
    fontWeight: "700",
    flex: 1
  },
  ttsDescButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(147,197,253,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.2)"
  },
  translation: {
    color: "#4ade80",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 8
  },
  desc: {
    color: "#bbb",
    fontSize: 13,
    marginBottom: 4
  },
  descTrans: {
    color: "#888",
    fontSize: 12,
    fontStyle: "italic",
    marginBottom: 8
  },
  grammar: {
    color: "#93c5fd",
    fontSize: 12,
    marginBottom: 8,
    fontStyle: "italic"
  },
  levelBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 8
  },
  levelBadgeText: {
    color: "#000",
    fontSize: 11,
    fontWeight: "800"
  },
  date: {
    color: "#666",
    fontSize: 11,
    marginTop: 4
  },

  // Error & Empty states
  errorTxt: {
    color: "#ff6b6b",
    marginTop: 10
  },
  bodyTxt: {
    color: "#ddd",
    marginTop: 12,
    textAlign: "center"
  }
});
