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
import { Audio } from "expo-av";
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
  label_grammar_no?: string;
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
  const [currentTasks, setCurrentTasks] = useState<ParsedTask[]>([]);
  
  const [questionIndex, setQuestionIndex] = useState(0);
  const totalQuestions = currentTasks.length;
  const currentQuestion = currentTasks[questionIndex] as ParsedTask | undefined;

  // Per Question answer UI state
  const [textAnswer, setTextAnswer] = useState("");
  const [selectedChoice, setSelectedChoice] = useState<"A" | "B" | "C" | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  // Audio recording state
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Store answers
  const [answers, setAnswers] = useState<Record<number, any>>({});

  // Feedback State
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedback, setFeedback] = useState<ParsedFeedback | null>(null);

  const [stage, setStage] = useState<'home'|'tasks'|'feedback'>('home');

  const [loadingTasks, setLoadingTasks] = useState(false);

  const hasItem = !!item;
  const showTrans = level !== "B2";

  async function ensureMicPermission() {
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== "granted") throw new Error("Missing Microphone permission");
  }

  async function startRecording() {
    try {
      await ensureMicPermission();

      // IOS/Android optimal settings: record in m4a
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY // m4a/aac
      );
      await rec.startAsync();

      setRecording(rec);
      setIsRecording(true);
      setAudioUri(null);
      setTranscript("");
    } catch (e) {
      console.error("Failed to start recording:", e);
      setIsRecording(false);
      setRecording(null);
    }
  }

  async function stopRecording() {
    try {
      if (!recording) return "";
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI() || null;
      setAudioUri(uri);
      setIsRecording(false);
      setRecording(null);

      if (uri) {
        setIsTranscribing(true);
        try {
          const text = await transcribeAudioWithOpenAI(uri); // Whisper call
          setTranscript(text);
          return (text || "").trim() || (uri ? "(audio)" : "");

        } finally {
          setIsTranscribing(false);
        }
      }
      return "";
    } catch (e) {
      console.error("Failed to stop recording:", e);
      setIsRecording(false);
      setRecording(null);
      setIsTranscribing(false);
      return "";
    }
  }

  async function toggleRecording() {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  }

  async function handleNextQuestion() {
    // Make sure speak has a answer
    let speakAnswer = "";
    // Stops recording if still recording
    if (isRecording) {
      speakAnswer = await stopRecording();
    }

    // Set current answer before removing all answers
    const answerForThis =
      currentQuestion?.mode === "multiple"
        ? selectedChoice
        : currentQuestion?.mode === "speak"
        ? (speakAnswer || transcript?.trim() || (audioUri ? "(audio)" : ""))
        : textAnswer.trim();

    // Create "local" nextAnswers og use it later
    const nextAnswers = {
      ...answers,
      [questionIndex]: answerForThis,
    };
    setAnswers(nextAnswers);

    // Reset per-question state
    setTextAnswer("");
    setSelectedChoice(null);
    setIsRecording(false);
    setRecording(null);
    setAudioUri(null);
    setTranscript("");
    setIsTranscribing(false);

    // Next question or finish
    if (questionIndex < totalQuestions - 1) {
      setQuestionIndex(questionIndex + 1);
      return;
    }

    // Ferdig med alle spørsmål:
    console.log("All questions answered:", nextAnswers);

    // 1) START spinner (på Modal #2 eller globalt)
    setFeedbackLoading(true);
    console.log("Grading...")

    try {
      // 2) KALL med riktige svar
      const fb = await callTaskFeedback(nextAnswers, currentTasks, level, targetLang);
      console.log("Finished grading")

      setFeedback(fb);
      
      setStage("feedback")
      console.log("Closed task modal")
    } catch (e) {
      console.error("Feedback Error: ", e);
    } finally {
      // 5) Stopp spinner til slutt
      setFeedbackLoading(false);
      console.log("Stopped Grading Process")
    }
  }


  function handleBackQuestion() {
    if (questionIndex > 0) setQuestionIndex(questionIndex - 1);
  }

  function getScoreDice(score: number | string) {
    const s = Number(score);

    const diceIcons: Record<number, string> = {
      1: "dice-one",
      2: "dice-two",
      3: "dice-three",
      4: "dice-four",
      5: "dice-five",
      6: "dice-six",
    };

    const iconName = diceIcons[s] ?? "question-circle"; // fallback
    return <FontAwesome5 name={iconName as any} size={50} color="#fff" />;
  }

  // Clean the grammar to get [ubestemt, bestemt, flertall ubestemt, flertall bestemt]
  function cleanGrammar(grammar: string) {
    const output = grammar.trim()
    
    return output;
  }

  return (
    <>
      {/* Modal #1: Main TaskSheet (hidden when task modal is open) */}
      {hasItem && (
        <Modal
          visible={visible && stage === 'home'}
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
                <Text style={[styles.subHeader, { marginTop: 13 }]}>{cleanGrammar(item.label_grammar_no)}</Text>

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

                        setStage('tasks');
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
        visible={visible && stage === 'tasks'}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => {
          setStage('home');
        }}
      >
        <View style={styles.backdrop}>
          <SafeAreaView style={styles.sheet}>
            {/* Close button */}
            <Pressable
              onPress={() => {
                setStage('home');
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
                  <Text style={styles.subHeader}>🇳🇴 | Si Setningen:</Text>
                  {level !== "B2" && (
                    <Text style={[styles.subHeader, { marginTop: 8 }]}>
                      {flagFor(targetLang)} | {t(targetLang, "saySentence")}</Text>
                  )}
                  <Text style={[styles.subHeader, { marginTop: 12 }]}>
                    {currentQuestion?.speak_text_no ?? "Speak text missing."}
                  </Text>

                  {/* Toggle to Record */}
                  <Pressable
                    onPress={toggleRecording}
                    style={[styles.recordBtn, isRecording && { opacity: 0.8 , backgroundColor: '#ff8787ff' }]}
                  >
                    <FontAwesome name={isRecording ? "stop" : "microphone"} size={50} color="white" />
                    <Text style={styles.recordTxt}>
                      {isRecording
                        ? (showTrans ? `Stopp opptak /  ${t(targetLang, "stopRecording")}` : "Stopp Opptak")
                        : (showTrans ? `Start opptak / ${t(targetLang, "startRecording")}` : "Start Opptak")}
                    </Text>
                    
                    {isRecording && (
                      <Text style={styles.recordTxt}>
                        {showTrans ? `Tar opptak... / ${t(targetLang, "recording")}` : "Tar opptak..."}
                      </Text>
                    )}
                  </Pressable>

                  {/* Transcribe Status */}
                  {isTranscribing && (
                    <Text style={[styles.subHeader, { fontStyle: "italic", marginTop: 10 }]}>
                      Transcribing...
                    </Text>
                  )}

                  {/* Transcribed text preview */}
                  {!!transcript && !isTranscribing && (
                    <View style={{ marginTop: 12 }}>
                      <Text style={[styles.subHeader, { fontWeight: "600" }]}>Transcription:</Text>
                      <Text style={{ color: "#fff", marginTop: 6 }}>{transcript}</Text>
                    </View>
                  )}
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
                  <Text style={styles.subHeader}>🇳🇴 | Skriv hva personen sier.</Text>
                  {level !== "B2" && (
                    <Text style={[styles.subHeader, { marginTop: 8 }]}>
                      {flagFor(targetLang)} | {t(targetLang, "writeSentence")}</Text>
                  )}
                  <Pressable
                    onPress={() => currentQuestion?.no && speak(currentQuestion.listen_text_no, "no")}
                    style={styles.listenBubble}
                  >
                    <Text style={styles.listenHint}><Feather name="volume-2" size={48} color="#9aa0a6" /></Text>
                    <Text style={styles.listenHint}>Trykk for å høre</Text>
                    {showTrans && <Text style={styles.listenHint}>{t(targetLang, "tapToListen")}</Text>}
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
            {/* Feedback Gen Loader */}
            {feedbackLoading && (
              <View style={styles.loaderOverlay} pointerEvents="auto">
                <View style={styles.loaderCard}>
                  <ActivityIndicator size="large" color="#fff" />
                  <Text style={styles.loaderText}>Grading Answers...</Text>
                </View>
              </View>
            )}
          </SafeAreaView>
        </View>
      </Modal>

      {/* Modal #3: Feedback And Grading */}
      <Modal
        visible={visible && stage === 'feedback'}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => setStage('home')}
      >
        <View style={styles.backdrop}>
          <SafeAreaView style={styles.sheet}>
            <Pressable onPress={() => setStage('home')} style={styles.closeBtn} hitSlop={12}>
              <MaterialIcons name="close" size={32} color="#fff" />
            </Pressable>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingTop: 56, paddingHorizontal: 16, paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.header}>Feedback</Text>

              {/* Overall */}
              {!!feedback && (
                <View style={styles.fbCard}>
                  <View style={styles.fbRow}>
                    {/* Left: Dice only */}
                    <View style={styles.fbLeft}>
                      {getScoreDice(feedback.overall_score)}
                      <Text style={styles.fbLeftLabel}>Overall</Text>
                    </View>

                    {/* Separator */}
                    <View style={styles.fbSep} />

                    {/* Right: Text */}
                    <View style={styles.fbRight}>
                      {!!feedback.overall_feedback_no && (
                        <Text style={styles.fbText}>
                          🇳🇴 {feedback.overall_feedback_no}
                        </Text>
                      )}
                      {showTrans && !!feedback.overall_feedback_trans && (
                        <Text style={styles.fbTextMuted}>
                          {flagFor(targetLang)} {feedback.overall_feedback_trans}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              )}

              {/* Each Task */}
              {!!feedback && (
                <View style={{ marginTop: 18 }}>
                  <Text style={[styles.subHeader, { fontStyle: "italic" }]}>Each Task</Text>

                  {currentTasks.map((task, i) => {
                    const s = feedback.task_scores.find(x => x.index === i)?.score;
                    const c_no = feedback.task_feedback.find(x => x.index === i)?.comment_no ?? "";
                    const c_trans = feedback.task_feedback.find(x => x.index === i)?.comment_trans ?? "";

                    const qNo = task.mode === "speak"
                      ? task.speak_text_no
                      : task.mode === "listen"
                      ? (task.listen_text_no ?? task.no)
                      : task.no;
                    const qTrans = task.trans;

                    // Tekst for MC-svar/fasit (valgfritt, men clean)
                    const raw = String(answers[i] ?? "-");
                    const userTxt = task.choices_no?.[raw as "A"|"B"|"C"];
                    const corr = task.correct_no;
                    const corrTxt = corr ? task.choices_no?.[corr] : undefined;

                    return (
                      <View key={i} style={styles.fbCard}>
                        <View style={styles.fbRow}>
                          {/* Left: Dice */}
                          <View style={styles.fbLeft}>
                            {getScoreDice(s ?? "-")}
                            <Text style={styles.fbLeftLabel}>Task {i+1}</Text>
                            <Text style={styles.fbLeftPill}>{task.mode.toUpperCase()}</Text>
                          </View>

                          {/* Sep */}
                          <View style={styles.fbSep} />

                          {/* Right: Content */}
                          <View style={styles.fbRight}>
                            {/* Oppgave */}
                            {!!qNo && (
                              <View style={{ marginBottom: 8 }}>
                                <Text style={styles.fbTitle}>🇳🇴 Oppgave</Text>
                                <Text style={styles.fbQuestion}>{qNo}</Text>
                                {showTrans && !!qTrans && (
                                  <>
                                    <Text style={styles.fbTitleMuted}>{flagFor(targetLang)} Task</Text>
                                    <Text style={styles.fbTextMuted}>{qTrans}</Text>
                                  </>
                                )}
                              </View>
                            )}

                            {/* Multiple: vis alternativer + svar/fasit */}
                            {task.mode === "multiple" && (
                              <View style={{ marginBottom: 8 }}>
                                {(["A","B","C"] as const).map(k => (
                                  <Text key={k} style={styles.choiceLine}>
                                    {k}: {task.choices_no?.[k] ?? "—"}
                                  </Text>
                                ))}
                                <Text style={styles.answerLine}>
                                  Ditt svar: {raw}{userTxt ? ` (${userTxt})` : ""}
                                  {typeof corr === "string" && (
                                    <>  •  Fasit: {corr}{corrTxt ? ` (${corrTxt})` : ""}</>
                                  )}
                                </Text>
                              </View>
                            )}

                            {/* Andre moduser: vis ditt svar */}
                            {task.mode !== "multiple" && (
                              <Text style={styles.answerLine}>
                                Ditt svar: {String(answers[i] ?? "-")}
                              </Text>
                            )}

                            {/* Kommentarer */}
                            {!!c_no && (
                              <>
                                <Text style={styles.fbTitle}>🇳🇴 Kommentar</Text>
                                <Text style={styles.fbText}>{c_no}</Text>
                              </>
                            )}
                            {showTrans && !!c_trans && (
                              <>
                                <Text style={styles.fbTitleMuted}>{flagFor(targetLang)} Comment</Text>
                                <Text style={styles.fbTextMuted}>{c_trans}</Text>
                              </>
                            )}
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
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

    GLOBALE KRAV
    - Bruk "${word}" naturlig i kontekst. Ikke be om ren oversettelse av enkeltord.
    - Variér modus: "speak" | "write" | "listen" | "multiple" (maks to av samme type).
    - Minst én "multiple" + minst én annen modus enn "multiple".
    - Unngå trivielle/fakta-løse spørsmål. Svar skal være mulig å vurdere objektivt.

    NIVÅ (CEFR) – forventet lengde på elevens svar
    - A1: 1 ord
    - A2: ≤ 3 ord
    - B1: én kort setning (≤ 12 ord)
    - B2: én tydelig setning (≤ 20 ord) med rimelig grammatikk

    MODUSSPESIFIKT
    - speak: IKKE lag spørsmål. Returner KUN én kort norsk setning eleven skal gjenta → felt: "speak_text_no".
    - write: Lag en naturlig skriveoppgave. Felt: "no" (norsk instruks) + "trans" (oversettelse til ${language}).
    - listen: Lag ÉN norsk setning som skal spilles av → felt: "listen_text_no". (Instruks i "no", men vurderingen bruker "listen_text_no".)
    - multiple:
      • Spørsmålet i "no" + "trans".
      • Tre plausible norske alternativer i "choices_no" (A,B,C). Kun én er objektivt riktig i "correct_no".
      • Oversettelser i "choices_trans".
      • Unngå preferanse-spørsmål; bruk fakta/kategori/bruk (der én er *klart riktig*).
      • Eksempel på ok: «Hvilken kategori er "${word}"?» (A: Frukt, B: Bil, C: By). Ikke ok: «Hva liker du best?»

    KVALITET PÅ ALTERNATIVER
    - Alle alternativer må passe konteksten. Unngå meningsløse valg (f.eks. "Bøker" som TV-innhold hvis konteksten ikke er “bokprogram”).
    - Dersom tema naturlig er TV/objekter, bruk realistiske typer (serier, nyheter, sport, dokumentar, matlaging osv.).

    JSON-SKJEMA
    {
      "tasks": [
        // speak
        { "mode": "speak", "speak_text_no": "..." },

        // write
        { "mode": "write", "no": "...", "trans": "..." },

        // listen
        { "mode": "listen", "no": "Instruks på norsk (kort)", "listen_text_no": "SETNINGEN SOM SPILLES AV" },

        // multiple
        {
          "mode": "multiple",
          "no": "...",
          "trans": "...",
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

function mapMcAnswerToText(task: ParsedTask, raw: "A"|"B"|"C"|null|undefined) {
  if (!task?.choices_no || !raw) return null;
  return task.choices_no[raw as "A"|"B"|"C"] ?? null;
}

function buildExpandedTasks(tasks: ParsedTask[], user_answers: Record<number, any>) {
  return tasks.map((t, i) => {
    const raw = user_answers[i]; // kan være "A"/"B"/"C" eller tekst/(audio)
    const user_text_for_mc = t.mode === "multiple" ? mapMcAnswerToText(t, raw) : null;

    return {
      index: i,
      mode: t.mode,
      // Spørsmål/innhold brukt i vurderingen
      question_no:
        t.mode === "speak" ? (t.speak_text_no ?? "") :
        t.mode === "listen" ? (t.listen_text_no ?? "") :
        (t.no ?? ""),
      question_trans: t.trans ?? "",

      // MC-detaljer
      choices_no: t.choices_no ?? null,
      choices_trans: t.choices_trans ?? null,
      correct_no: t.correct_no ?? null,

      // Brukersvar
      user_answer_raw: raw ?? "",
      user_answer_text: user_text_for_mc ?? (typeof raw === "string" ? raw : String(raw ?? "")),

      // Nivåhjelp
      level_hint: {
        A1: "forvent 1 ord",
        A2: "≤ 3 ord",
        B1: "1 kort setning (≤ 12 ord)",
        B2: "1 tydelig setning (≤ 20 ord, rimelig grammatikk)"
      }
    };
  });
}

async function callTaskFeedback(
  user_answers: Record<number, any>,
  tasks: ParsedTask[],
  level: TaskSheetProps["level"],
  targetLang: string
) {
  const expanded = buildExpandedTasks(tasks, user_answers);

  const inputPayload = {
    level,
    target_language: targetLang,
    tasks: expanded
  };

  const prompt = `
Du er en erfaren norsklærer og sensor (CEFR A1–B2). Du får komplette oppgaveobjekter og elevsvar.
Svar KUN med gyldig UTF-8 JSON. Ingen kodeblokker, ingen ekstra felt, ingen trailing-komma.

INNDATA (JSON)
${JSON.stringify(inputPayload)}

VURDERINGSREGLER (OBLIGATORISK)
1) MULTIPLE:
   - Bruk "correct_no" og "user_answer_raw" deterministisk.
   - Hvis lik → score 6 (evt 5–6 hvis du vil nyansere marginale tilfeller).
   - Hvis ulik → score 2 (evt 1–3 hvis noe resonnering i "user_answer_text" henger på greip).
   - Ikke trekk for lengde i MC. Ikke be om mer tekst i MC-kommentarer.
   - I kommentaren: bekreft korrekt/feil og vis riktig alternativ TEKSTLIG (ikke bare bokstav).

2) WRITE / LISTEN:
   - Vurder menings­treff mot "question_no" (WRITE) eller "question_no"=lydsetning (LISTEN).
   - Tillat små stavefeil/nærsynonymer hvis meningen er tydelig.
   - Knyt score til CEFR-lengdekrav (se "level_hint" for oppgaven).
   - LISTEN: Trekk hvis viktige elementer mangler (f.eks. du skrev bare halvparten).

3) SPEAK:
   - Hvis "user_answer_raw" er tekstlig transkripsjon → vurder innhold (mening), ordstilling og omfang i tråd med nivå.
   - Hvis "user_answer_raw" == "(audio)" uten tekst → sett 4 som default (gjennomført, men ikke verifiserbar).
   - Tomt svar → 1.

4) SKALA (terningkast 1–6):
   - 6: Presist, komplett og naturlig for nivået.
   - 5: Småfeil, ellers klart og riktig.
   - 4: Forståelig, men merkbare feil/avvik.
   - 3: Delvis riktig; vesentlige hull/feil.
   - 2: Stort sett feil eller lav måloppnåelse.
   - 1: Tomt/uforståelig/på siden.

5) KOMMENTARER:
   - Per oppgave: 1–2 setninger. Konkrete grep neste gang (ordvalg, bøying, ordstilling, uttalehint, lytting).
   - Unngå metakommentarer (f.eks. "svaret er kort") i MC.
   - Samlet: 3–6 setninger, motiverende, med 2–3 neste steg.

6) SPRÅK:
   - Alle kommentarer på norsk i "comment_no".
   - Gi direkte oversettelse til ${targetLang} i "comment_trans".

OUTPUT (NØYAKTIG SKJEMA)
{
  "task_scores": [ { "index": 0, "score": 1 } ],
  "task_feedback": [ { "index": 0, "comment_no": "...", "comment_trans": "..." } ],
  "overall_score": { "score": 1 },
  "overall_feedback": { "comment_no": "...", "comment_trans": "..." }
}

KONSISTENS
- Antall elementer i "task_scores" og "task_feedback" == antall oppgaver.
- "index" er 0-basert.
- "score" er heltall 1-6.
`.trim();

  // kald og stabil sensur
  const output = await callOpenAIWithTimeout(prompt, 30000, /*temperature*/ 0.0);
  const parsedOutput = parseFeedbackText(output);
  return parsedOutput;
}



// Async funciton to be sure openai can recieve prompt
async function callOpenAIWithTimeout(prompt: string, ms: number, temperature = 0.2) {
  const control = new AbortController();
  const timeout = setTimeout(() => control.abort(), ms);
  try {
    return await callOpenAI(prompt, control.signal, temperature);
  } finally {
    clearTimeout(timeout);
  }
}

// Function to call OpenAI and get its output text
async function callOpenAI(prompt: string, signal?: AbortSignal, temperature = 0.2) {
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
      model: MODEL,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      temperature, // ← bruker parameteren
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error("OpenAI error \${response.status}: \${errText}\"");
  }
  const data = await response.json();
  return getOutputText(data);
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
        listen_text_no: t.listen_text_no ?? undefined,
        no: t.no?.trim?.() ?? undefined,
        trans: t.trans?.trim?.() ?? undefined,
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

type ParsedFeedback = {
  task_scores: { index: number; score: number }[];
  task_feedback: { index: number; comment_no: string; comment_trans: string }[];
  overall_score: number;
  overall_feedback_no: string;
  overall_feedback_trans: string;
};

function parseFeedbackText(text: string): ParsedFeedback | null {
  try {
    const cleanText = text.replace(/```json/i, "").replace(/```/g, "").trim();
    const jsonMatch = cleanText.match(/\{[\s\S]*\}$/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleanText);

    // --- scores ---
    const task_scores = Array.isArray(parsed?.task_scores)
      ? parsed.task_scores
          .filter((t: any) => Number.isInteger(t?.index) && typeof t?.score === "number")
          .map((t: any) => ({
            index: t.index,
            score: Math.max(1, Math.min(6, t.score)),
          }))
      : [];

    // --- per-task feedback (tolerant mot gamle nøkler) ---
    const task_feedback = Array.isArray(parsed?.task_feedback)
      ? parsed.task_feedback
          .filter((t: any) => Number.isInteger(t?.index))
          .map((t: any) => {
            // Støtt både nytt og gammelt schema
            const no =
              typeof t.comment_no === "string"
                ? t.comment_no
                : typeof t.comment === "string" // gammel nøkkel
                ? t.comment
                : "";
            const tr =
              typeof t.comment_trans === "string"
                ? t.comment_trans
                : typeof t.comment_en === "string" // evt. variant
                ? t.comment_en
                : "";
            return { index: t.index, comment_no: no.trim(), comment_trans: tr.trim() };
          })
      : [];

    // --- overall (tolerant) ---
    const overallObj = parsed?.overall_feedback ?? {};
    const overallNo =
      typeof overallObj.comment_no === "string"
        ? overallObj.comment_no
        : typeof overallObj.comment === "string"
        ? overallObj.comment
        : "";
    const overallTr =
      typeof overallObj.comment_trans === "string"
        ? overallObj.comment_trans
        : typeof overallObj.comment_en === "string"
        ? overallObj.comment_en
        : "";

    const overall_score =
      typeof parsed?.overall_score?.score === "number"
        ? Math.max(1, Math.min(6, parsed.overall_score.score))
        : 0;

    return {
      task_scores,
      task_feedback,
      overall_score,
      overall_feedback_no: overallNo.trim(),
      overall_feedback_trans: overallTr.trim(),
    };
  } catch (err) {
    console.error("Feil ved parsing av feedback:", err, "\nRåtekst:\n", text);
    return null;
  }
}

async function transcribeAudioWithOpenAI(fileUri: string) {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!key) throw new Error("Mangler EXPO_PUBLIC_OPENAI_API_KEY");

  const form = new FormData();
  // iOS/Android trenger type & name
  form.append("file", {
    uri: fileUri,
    type: "audio/m4a",
    name: "speech.m4a",
  } as any);
  form.append("model", "whisper-1"); // stabil STT
  form.append("language", "no");     // norsk

  const rsp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}` },
    body: form,
  });
  if (!rsp.ok) throw new Error(await rsp.text());
  const json = await rsp.json();
  // Whisper returnerer .text
  return (json.text || "").trim();
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
    backgroundColor: "rgba(0, 0, 0, 0.5)", // grå/lav opasitet foreground
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
    fbCard: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  fbRow: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 80,
  },
  fbLeft: {
    width: 84,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    margin: 10,
  },
  fbLeftLabel: {
    color: "#bdbdbd",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  fbLeftPill: {
    color: "#fff",
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  fbSep: {
    width: 1,
    backgroundColor: "rgba(255,255,255,0.15)", // tynn vertikal strek
    marginVertical: 10,
  },
  fbRight: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 6,
  },
  fbTitle: {
    color: "#e8eaed",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  fbTitleMuted: {
    color: "#c0c5cc",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 6,
  },
  fbQuestion: {
    color: "#ffffff",
    fontSize: 14,
    marginTop: 2,
  },
  fbText: {
    color: "#ddd",
    fontSize: 13,
    lineHeight: 18,
  },
  fbTextMuted: {
    color: "#9aa0a6",
    fontSize: 12,
    lineHeight: 18,
  },
  choiceLine: {
    color: "#ddd",
    fontSize: 13,
    marginTop: 2,
  },
  answerLine: {
    color: "#9aa0a6",
    fontSize: 12,
    marginTop: 8,
  },


});
