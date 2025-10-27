import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Feather from '@expo/vector-icons/Feather';

import { SafeAreaView } from "react-native-safe-area-context";

import { t, languageNameFromCode } from "../../components/i18n";
import { flagFor } from "../../components/flags";
type SimpleTask = { no:string; trans:string; };


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

export default function TaskSheet(props: TaskSheetProps) {
  const { visible, onClose, item, targetLang, level, speak } = props;
  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const [currentTasks, setCurrentTasks] = useState<SimpleTask[]>([]);
  
  const [questionIndex, setQuestionIndex] = useState(0);
  const totalQuestions = currentTasks.length;
  const currentQuestion = currentTasks[questionIndex] as ParsedTask | undefined;

  // Per Question answer UI state
  const [textAnswer, setTextAnswer] = useState("");
  const [selectedChoice, setSelectedChoice] = useState<"A" | "B" | "C" | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  // Store answers
  const [answers, setAnswers] = useState<Record<number, any>>({});

  const [loadingTasks, setLoadingTasks] = useState(false);

  const hasItem = !!item;

  async function startRecording() {
  setIsRecording(true);
  // TODO: Implement recording logic
  }

  async function stopRecording() {
    setIsRecording(false);
    // TODO: Implement stop recording logic
  }

  function handleNextQuestion() {
    // Store answer
    setAnswers((prev) => ({
      ...prev,
      [questionIndex]:
        currentQuestion?.mode === "multiple"
          ? selectedChoice
          : currentQuestion?.mode === "speak"
          ? "(audio)"
          : textAnswer.trim(),
    }));
    // Reset per-question state
    setTextAnswer("");
    setSelectedChoice(null);
    setIsRecording(false);

    if (questionIndex < totalQuestions - 1) setQuestionIndex(questionIndex + 1);
    else {
      // All questions answered
      console.log("All questions answered:", answers);
    }
  }

  function handleBackQuestion() {
    if (questionIndex > 0) setQuestionIndex(questionIndex - 1);
  }
  
  return (
    <>
      {/* Modal #1: Main TaskSheet (hidden when task modal is open) */}
      {hasItem && (
        <Modal
          visible={visible && !taskModalVisible} // hide when task modal is open
          transparent
          animationType="fade"
          onRequestClose={onClose}
          presentationStyle="overFullScreen"
          statusBarTranslucent
        >
          <View style={styles.backdrop}>
            <SafeAreaView style={styles.sheet}>

              {/* Close button (top-left) */}
              <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12}>
                <MaterialIcons name="close" size={32} color="#fff" />
              </Pressable>

              {/* Content */}
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{
                  paddingTop: 112,
                  paddingHorizontal: 16,
                  paddingBottom: 24,
                }}
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
                    <Text style={styles.chipTxt}>{flagFor(targetLang)} {item.desc_TRANS}</Text>
                  </Pressable>
                )}

                {/* Meta */}
                {typeof item.confidence === "number" && (
                  <Text style={styles.meta}>
                    Sikkerhet/{t(targetLang, "confidence")}:{" "}
                    {(item.confidence * 100).toFixed(0)}%
                  </Text>
                )}
                <Text style={styles.meta}>
                  Nivå/{t(targetLang, "level")}: {level} • Språk/
                  {t(targetLang, "language")}: {targetLang.toUpperCase()}
                </Text>

                {/* Buttons */}
                <View style={styles.actions}>
                  <Pressable
                    style={[styles.actionBtn, styles.primary, loadingTasks && { opacity: 0.6 }]}
                    disabled={loadingTasks}
                    onPress={async () => {
                      try {
                        setLoadingTasks(true);
                        const raw = await logRandomTask(item.label_NO, targetLang, level);
                        const parsed = parseOutputText(raw);
                        setCurrentTasks(parsed);

                        // Reset question state
                        setQuestionIndex(0);
                        setTextAnswer("");
                        setSelectedChoice(null);
                        setIsRecording(false);
                        setAnswers({});

                        setTaskModalVisible(true); // show the task modal
                        console.log("parsed length:", parsed.length);
                      } catch (e) {
                        console.error("Task gen error:", e);
                      } finally {
                        setLoadingTasks(false);
                      }
                    }}
                  >
                    <Text style={styles.actionTxt}>
                      Start Oppgave / {t(targetLang, "startTask")}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[styles.actionBtn, styles.secondary]}
                    onPress={() => speak(item.label_NO, "no")}
                  >
                    <Text style={styles.actionTxt}>
                      Si norsk ord / {t(targetLang, "sayNorwegianWord")}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[styles.actionBtn, styles.secondary]}
                    onPress={() => speak(item.label_TRANS, "else")}
                  >
                    <Text style={styles.actionTxt}>
                      Si oversettelse / {t(targetLang, "sayTranslation")}
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>

              {/* Loader Overlay */}
              {loadingTasks && (
                <View style={styles.loaderOverlay} pointerEvents="auto">
                  <View style={styles.loaderCard}>
                    <ActivityIndicator size="large" color="#fff" />
                    <Text style={styles.loaderText}>Generating tasks...</Text>
                  </View>
                </View>
              )}
            </SafeAreaView>
          </View>
        </Modal>
      )}

      {/* Modal #2: After Starting Task */}
      <Modal
        visible={taskModalVisible}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => {
          setTaskModalVisible(false);
        }}
      >
        <View style={styles.backdrop}>
          <SafeAreaView style={styles.sheet}>
            {/* Close button */}
            <Pressable
              onPress={() => {
                setTaskModalVisible(false);
              }}
              style={styles.closeBtn}
              hitSlop={12}
            >
              <MaterialIcons name="close" size={32} color="#fff" />
            </Pressable>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingTop: 56,
                paddingHorizontal: 16,
                paddingBottom: 24,
              }}
              showsVerticalScrollIndicator={false}
            >
              {/* Question Header */}
              <Text style={styles.header}>
                {level !== "B2"
                  ? `Spørsmål / ${t(targetLang, "question")}: ${questionIndex + 1} / ${totalQuestions}`
                  : "Spørsmål: " + (questionIndex + 1) + " / " + totalQuestions}
              </Text>

              {/* Question Content */}
              {currentQuestion?.mode === "speak" ? (
                <>
                  {/* Speak Mode Content */}
                  <Text style={[styles.subHeader, { fontWeight: "600" }]}>Si setningen:</Text>
                  <Text style={[styles.subHeader, { marginTop: 12 }]}>
                    {currentQuestion?.speak_text_no ?? "Speak text missing."}
                  </Text>


                  {/* Hold to Record */}
                  <Pressable
                    onPressIn={startRecording}
                    onPressOut={stopRecording}
                    style={[styles.recordBtn, isRecording && { opacity: 0.8 , backgroundColor: '#ff8787ff' }]}
                  >
                    <FontAwesome name="microphone" size={50} color="white" />
                    <Text style={styles.recordTxt}>
                      {isRecording
                        ? (level !== "B2"
                            ? `Tar opptak... / ${t(targetLang, "recording")}`
                            : "Tar opptak...")
                        : (level !== "B2"
                            ? `Hold inne for å spille inn svar / ${t(targetLang, "holdToRecord")}`
                            : "Hold inne for å spille inn svar")}
                    </Text>
                    <Text style={styles.recordTxt}>
                      {isRecording ? `${t(targetLang, "recording")}` : `${t(targetLang, "holdToRecord")}`}
                    </Text>
                  </Pressable>
                </>
              ) : currentQuestion?.mode === "write" ? (
                <>
                  {/* Write Mode Content */}
                  <Text style={styles.subHeader}>🇳🇴 | {currentQuestion?.no}</Text>
                  {level !== "B2" && (
                    <Text style={[styles.subHeader, { marginTop: 8 }]}>
                      {flagFor(targetLang)} | {currentQuestion?.trans}</Text>
                  )}
                  <TextInput
                    value={textAnswer}
                    onChangeText={setTextAnswer}
                    placeholder={
                      level !== "B2"
                        ? `Skriv svaret ditt her / ${t(targetLang, "typeAnswerHere")}`
                        : "Skriv svaret ditt her"
                    }
                    placeholderTextColor="#9aa0a6"
                    style={styles.input}
                  />
                </>
              ) : currentQuestion?.mode === "listen" ? (
                <>
                  {/* Listen Mode Content */}
                  <Text style={styles.subHeader}>{currentQuestion?.no}</Text>
                  <Pressable
                    onPress={() => currentQuestion?.listen_text_no && speak(currentQuestion.listen_text_no, "no")}
                    style={styles.listenBubble}
                  >
                    <Text style={styles.listenHint}><Feather name="volume-2" size={48} color="#9aa0a6" /></Text>
                    <Text style={styles.listenHint}>Trykk for å høre</Text>
                    {level !== "B2" && <Text style={styles.listenHint}>{t(targetLang, "tapToListen")}</Text>}
                  </Pressable>
                  <TextInput
                    value={textAnswer}
                    onChangeText={setTextAnswer}
                    placeholder={
                      level !== "B2"
                        ? `Hva sa personen? / ${t(targetLang, "whatDidTheySay")}`
                        : "Hva sa personen?"
                    }
                    placeholderTextColor="#9aa0a6"
                    style={styles.input}
                  />
                </>
              ) : currentQuestion?.mode === "multiple" ? (
                <>
                  {/* Multiple Choice Content */}
                  
                  <Text style={styles.subHeader}>🇳🇴 | {currentQuestion?.no}</Text>
                  { level !== "B2" && <Text style={styles.subHeader}>{flagFor(targetLang)} | {currentQuestion?.trans}</Text>}
                  <View style={{ marginTop: 10, gap: 8 }}>

                    {/* Answer Choices */}
                    {(["A", "B", "C"] as const).map((key) => (
                      <Pressable
                        key={key}
                        onPress={() => setSelectedChoice(key)}
                        style={[
                          styles.choiceBtn,
                          selectedChoice === key && styles.choiceBtnSelected,
                        ]}
                      >
                        <Text style={styles.choiceTxt}>
                          {key}: {currentQuestion?.choices_no?.[key]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={styles.subHeader}>No Tasks</Text>
              )}

              {/* Navigation Buttons */}
              <View style={{ marginTop: 20, flexDirection: "row", gap: 10 }}>
                <Pressable
                  style={[styles.navBtn, { opacity: questionIndex === 0 ? 0.5 : 1 }]}
                  disabled={questionIndex === 0}
                  onPress={handleBackQuestion}
                >
                  <Text style={styles.actionTxt}><Feather name="arrow-left" size={18} color="white"/>
                    {
                      level !== "B2"
                        ? `Tilbake / ${t(targetLang, "back")}`
                        : "Tilbake"
                    }</Text>
                </Pressable>

                <Pressable
                  style={[styles.navBtnPrimary]}
                  onPress={handleNextQuestion}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <Text style={styles.actionTxt}>
                      {questionIndex < totalQuestions - 1 ? (
                        <>
                          {
                            level !== "B2"
                              ? `Neste / ${t(targetLang, "next")}`
                              : "Neste"
                          }
                          <Feather name="arrow-right" size={18} color="white" />
                        </>
                      ) : (
                        <>
                        {
                          level !== "B2"
                            ? `Fullfør / ${t(targetLang, "finish")}`
                            : "Fullfør"
                        }
                        </>
                      )}
                    </Text>
                  </View>
                </Pressable>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}




async function logRandomTask(word: string, language: string, level: TaskSheetProps["level"]) {
    console.log("Started Calling")
    const prompt = `
    Du er en norsk språklærer. Lag nøyaktig 5 korte oppgaver som trener ordet/objektet "${word}" for en elev på nivå "${level}" (A1, A2, B1 eller B2).
    Svar KUN med gyldig JSON (ingen forklaring, ingen kodeblokk, ingen trailing-komma). UTF-8.

    FELLES KRAV
    - Bruk "${word}" i naturlig sammenheng. Ikke be om direkte oversettelser av enkeltord.
    - Under 1 minutt å svare.
    - Modus per oppgave (tilfeldig valgt, men ikke mer enn to av samme type): "speak" | "write" | "listen" | "multiple".
    - Minst én oppgave skal være "multiple" og minst én skal være en annen modus enn "multiple".
    - Forby oppgaver av typen: "Hva er 'X' på norsk?", "Skriv ordet 'X' på norsk", eller trivielle spørsmål med åpenbar fasit i teksten.

    NIVÅREGLER (styr hvordan du formulerer oppgavene):
    - A1: forventet svar = 1 ord.
    - A2: forventet svar = maks 3 ord.
    - B1: forventet svar = én kort setning (≤ 12 ord).
    - B2: forventet svar = en tydelig setning med korrekt grammatikk (≤ 20 ord).

    MODUS-SPESIFIKKE KRAV
    - speak: IKKE lag et spørsmål/oppgavetekst. Returnér KUN én kort norsk setning om "${word}" som eleven skal gjenta. Felt: "speak_text_no".
    - write: Lag en naturlig oppgave (på norsk) der svaret skrives. Felt: "no" + "trans".
    - listen: Lag en naturlig oppgave (på norsk) i "no" + "trans" og gi setningen som skal leses i "listen_text_no" (kort norsk setning; ikke bare kopi av "no").
    - multiple: Lag spørsmålet i "no" + "trans" og tre plausible svar på norsk i "choices_no" (A,B,C), med kun ett riktig i "correct_no". Lag oversettelser i "choices_trans". Svaret skal kun være faktabasert riktig. 

    JSON-SKJEMA
    - Inkluder KUN felter som gjelder for valgt modus (dvs. ikke ta med choices når mode ≠ "multiple", osv.).
    - Toppnøkkel "tasks" skal være en liste med 5 elementer.

    FORMAT (abstrakt, ikke eksempelinnhold):
    {
      "tasks": [
        {
          "mode": "speak",
          "speak_text_no": "én kort norsk setning om ${word}"
        },
        {
          "mode": "write",
          "no": "oppgavetekst på norsk",
          "trans": "oppgavetekst oversatt til ${language}"
        },
        {
          "mode": "listen",
          "no": "oppgavetekst på norsk",
          "trans": "oppgavetekst oversatt til ${language}",
          "listen_text_no": "kort norsk setning som leses"
        },
        {
          "mode": "multiple",
          "no": "spørsmål på norsk",
          "trans": "spørsmål oversatt til ${language}",
          "choices_no": { "A": "...", "B": "...", "C": "..." },
          "correct_no": "A",
          "choices_trans": { "A": "...", "B": "...", "C": "..." }
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

type ParsedTask = {
  mode: "write" | "speak" | "listen" | "multiple";
  // speak
  speak_text_no?: string;
  // write/listen/multiple felles
  no?: string;
  trans?: string;
  // listen
  listen_text_no?: string;
  // multiple
  choices_no?: Record<"A"|"B"|"C", string>;
  choices_trans?: Record<"A"|"B"|"C", string>;
  correct_no?: "A"|"B"|"C";
};

function parseOutputText(text: string): ParsedTask[] {
  try {
    const cleanText = text.replace(/```json/i, "").replace(/```/g, "").trim();
    const jsonMatch = cleanText.match(/\{[\s\S]*\}$/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleanText);

    const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    return tasks
      .filter((t: any) => t && typeof t === "object")
      .map((t: any): ParsedTask => ({
        mode: t.mode,
        speak_text_no: t.speak_text_no ?? undefined,
        no: t.no?.trim?.() ?? undefined,
        trans: t.trans?.trim?.() ?? undefined,
        listen_text_no: t.listen_text_no ?? undefined,
        choices_no: t.choices_no ?? undefined,
        choices_trans: t.choices_trans ?? undefined,
        correct_no: t.correct_no ?? undefined,
      }))
      .filter((t: any) => !!t.mode);
  } catch (err) {
    console.error("Feil ved parsing:", err);
    return [];
  }
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

  loaderOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.35)", // grå/lav opasitet foreground
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  loaderCard: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
    minWidth: 220,
  },
  loaderText: {
    marginTop: 10,
    color: "#fff",
    fontWeight: "700",
  },
  bigPrompt: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
  },

  input: {
    marginTop: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 12,
  },

  recordBtn: {
    width: 180,
    height: 190,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    backgroundColor: "#ef4444",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 5,
  },

  recordTxt: {
    color: "#fff",
    fontSize: 12,
    textAlign: "center",
    fontWeight: "700",
    marginTop: 12,
  },

  listenBubble: {
    marginTop: 12,
    width: 170,
    alignSelf: "center",        // <- center the bubble itself
    alignItems: "center",        // <- center content horizontally
    justifyContent: "center",    // <- center vertical
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },

  listenBubbleTxt: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },

  listenHint: {
    color: "#9aa0a6",
    fontSize: 12,
    marginTop: 6,
    fontStyle: "italic",
  },

  choiceBtn: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  choiceBtnSelected: {
    borderColor: "#3b82f6",
    backgroundColor: "rgba(59,130,246,0.2)",
  },
  choiceTxt: {
    color: "#fff",
    fontSize: 16,
  },

  navBtn: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  navBtnPrimary: {
    flex: 1,
    backgroundColor: "#3b82f6",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },

});
