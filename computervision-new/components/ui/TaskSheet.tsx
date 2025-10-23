import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

import { t, languageNameFromCode } from "../../components/i18n";


const MODEL = "gpt-4o-mini"; // What GPT model to use for image detection
const OPENAI_URL = "https://api.openai.com/v1/responses";

export type DetectedItem = {
  label_NO: string;
  label_TRANS: string;
  desc_NO?: string;
  desc_TRANS?: string;
  confidence?: number;
  x1?: number; y1?: number; x2?: number; y2?: number; cx?: number; cy?: number;
};

type TaskSheetProps = {
  visible: boolean;
  onClose: () => void;

  // Data for oppgaven
  item: DetectedItem | null;

  // Språk og nivå
  targetLang: string;   // f.eks. "en", "es"
  level: "A1" | "A2" | "B1" | "B2";

  // Tale-funksjon (injiseres fra parent)
  speak: (text: string, language: "no" | "else") => void;

  // Når bruker starter en oppgave
  onStartTask?: (item: DetectedItem, options: { level: TaskSheetProps["level"]; lang: string }) => void;
};

export default function TaskSheet({
  visible,
  onClose,
  item,
  targetLang,
  level,
  speak,
  onStartTask,
}: TaskSheetProps) {
  if (!item) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet}>
          {/* Close button (top-left) */}
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12}>
            <MaterialIcons name="close" size={32} color="#fff" />
          </Pressable>

          {/* Content */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingTop: 56, paddingHorizontal: 16, paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Header / labels */}
            <Text style={styles.header}>{item.label_NO?.toUpperCase()}</Text>
            <Text style={styles.subHeader}>{item.label_TRANS}</Text>

            {/* Descriptions */}
            {!!item.desc_NO && (
              <Pressable
                style={styles.chip}
                onPress={() => speak(item.desc_NO!, "no")}
              >
                <Text style={styles.chipTxt}>🇳🇴 {item.desc_NO}</Text>
              </Pressable>
            )}
            {!!item.desc_TRANS && (
              <Pressable
                style={styles.chip}
                onPress={() => speak(item.desc_TRANS!, "else")}
              >
                <Text style={styles.chipTxt}>🌐 {item.desc_TRANS}</Text>
              </Pressable>
            )}

            {/* Meta */}
            {typeof item.confidence === "number" && (
              <Text style={styles.meta}>Sikkerhet/{t(targetLang, "confidence")}: {(item.confidence * 100).toFixed(0)}%</Text>
            )}
            <Text style={styles.meta}>Nivå/{t(targetLang, "level")}: {level} • Språk/{t(targetLang, "language")}: {targetLang.toUpperCase()}</Text>

            {/* Actions */}
            <View style={styles.actions}>
              <Pressable
                style={[styles.actionBtn, styles.primary]}
                onPress={async () => {
                    try {
                        await logRandomTask(item.label_NO, targetLang, level);
                    } catch (e) {
                        console.error("Task gen error:", e);
                    }
                }}
                    
              >
                <Text style={styles.actionTxt}>Start Oppgave / {t(targetLang, "startTask")}</Text>
              </Pressable>

              <Pressable
                style={[styles.actionBtn, styles.secondary]}
                onPress={() => speak(item.label_NO, "no")}
              >
                <Text style={styles.actionTxt}>Si norsk ord / {t(targetLang, "sayNorwegianWord")}</Text>
              </Pressable>

              <Pressable
                style={[styles.actionBtn, styles.secondary]}
                onPress={() => speak(item.label_TRANS, "else")}
              >
                <Text style={styles.actionTxt}>Si oversettelse / {t(targetLang, "sayTranslation")}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

async function logRandomTask(word: string, language: string, level: string) {
    console.log("Started Calling")
    const prompt = `
    -Du er en norsk språklærer. Lag 5 korte, konkrete elevoppgaver på ${level}-nivå.
    -Vær kreativ med oppgavene og inkluder varierte oppgavetyper.
    -Oppgavene skal kunne bli besvart lett på under ett minutt kun ved å skrive en setning eller ord.
    -Alle oppgavene MÅ ha en sammenheng med objektet ${word}.
    -Oversett oppgaven direkte fra norsk til ${language} som task_..._trans

    A1-nivå: Brukeren skal kunne svare med ett ord.
    A2-nivå: Brukeren skal kunne svare med maks 3 ord.
    B1-nivå: Brukeren skal kunne svare med 1 kort setning.
    B2-nivå: Brukeren skal kunne svare med ett tydelig svar som en setning.

    Returner KUN gyldig JSON med:
    {
      "tasks": [
        {
          "task_1_no": "...",
          "task_1_trans": "...",
          "task_2_no": "...",
          "task_2_trans": "...",
          "task_3_no": "...",
          "task_3_trans": "...",
          "task_4_no": "...",
          "task_4_trans": "...",
          "task_5_no": "...",
          "task_5_trans": "...",
        }
      ]
    }
    `.trim();

    const output = await callOpenAIWithTimeout(prompt, 25000);
    console.log(output);
    return output;
}

// Async funciton to be sure openai can recieve prompt
async function callOpenAIWithTimeout(prompt: string, ms: number) {
  const control = new AbortController();
  const timeout = setTimeout(() => control.abort(), ms);
  try {
    return await callOpenAI(prompt, control.signal);
  } finally {
    clearTimeout(timeout);
  }
}

// Function to call OpenAI and get its output text
async function callOpenAI(prompt: string, signal?: AbortSignal) {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing EXPO_PUBLIC_OPENAI_API_KEY");

  const response = await fetch(OPENAI_URL, {
    // Sends a HTTP request to OpenAI
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`, // Send API
      "Content-Type": "application/json", // Tells OpenAI that we send a JSON
    },
    body: JSON.stringify({
      model: MODEL, // Which model to use
      input: [
        // What we send to the model. (text prompt)
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
          ],
        },
      ],
      temperature: 0.2,
    }),
    signal,
  });

  // If error
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`OpenAI error ${response.status}: ${errText}`);
  }

  const data = await response.json(); // Converts from text to JSON
  const textOut = getOutputText(data); // Extract the text field from openAi's output

  return textOut; // OpenAI's formatted text answer
}

// Function to extract the Output text from OpenAI
function getOutputText(data: any): string {
  // Find all content parts and merge them together
  return (
    data?.output
      ?.flatMap((msg: any) => msg?.content ?? [])
      ?.filter((p: any) => p?.type === "output_text")
      ?.map((p: any) => p?.text ?? "")
      ?.join("\n")
      ?.trim() ?? ""
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    flex: 1,
    backgroundColor: "#0c0c0c",
  },
  closeBtn: {
    position: "absolute",
    top: 50,
    left: 20,
    zIndex: 10,
    width: 50,
    height: 50,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  subHeader: {
    color: "#bdbdbd",
    fontSize: 16,
    marginTop: 4,
    marginBottom: 12,
  },
  chip: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  chipTxt: {
    color: "#ddd",
    fontSize: 12,
    fontStyle: "italic",
  },
  meta: {
    color: "#9aa0a6",
    fontSize: 12,
    marginTop: 6,
  },
  actions: {
    marginTop: 18,
    gap: 10,
  },
  actionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: { backgroundColor: "#3b82f6" },
  secondary: { backgroundColor: "rgba(255,255,255,0.08)" },
  actionTxt: { color: "#fff", fontWeight: "700" },
});
