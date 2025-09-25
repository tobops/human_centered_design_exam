// @ts-nocheck
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Dimensions, Animated, Platform, Image, Modal, TextInput, ScrollView, ActivityIndicator, Alert } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import Svg, { Rect } from "react-native-svg";

let Audio: any = null;                 // 👈 lazy
if (Platform.OS !== "web") {
  // @ts-ignore
  Audio = require("expo-av").Audio;
}

// ❌ fjernet: import translate from '@vitalets/google-translate-api';

const MODEL = "gpt-4.1-mini";        // evt "o4-mini" (tregere)
const MAX_SIDE = 768;                 
const JPEG_QUALITY = 0.85;

const PROMPT = `
Returner KUN gyldig JSON med nøyaktig dette skjemaet:
{"detections":[{"label_no":"klokke","confidence":0.97,"box_norm":{"xc":0.5000,"yc":0.5000,"w":0.3000,"h":0.4000}}]}

OPPGAVE
Analyser ett bilde og returner opptil fem objekter med presise bounding boxes og korte norske labels.

OUTPUTREGLER
- Kun JSON. Ingen forklaringer, ingen trailing komma.
- Felt:
  - label_no: kort norsk ord (maks to), spesifikt fremfor generelt.
  - confidence: [0,1], 2 desimaler.
  - box_norm: xc,yc,w,h ∈ [0,1], 4 desimaler, relativt til hele bildet.
- Sortér detections synkende på confidence.
- Returner {"detections":[]} hvis ingen sikre funn.

UNIVERSELLE PRINSIPPER ...
(… alt videre som du hadde …)
`;

const { width: SW, height: SH } = Dimensions.get("window");

export default function Screen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [facing, setFacing] = useState<"front"|"back">("front");
  const [busy, setBusy] = useState(false);

  // Preview state
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);
  const [boxes, setBoxes] = useState<any[]>([]);
  const flashAnim = useRef(new Animated.Value(0)).current;

  // Loading bar
  const [loading, setLoading] = useState(false);
  const prog = useRef(new Animated.Value(0)).current;

  // Oversettelse state
  const [barExpanded, setBarExpanded] = useState(false);
  const [predictionsWithEn, setPredictionsWithEn] = useState<any[]>([]);

  // 🔵 NEW: Task modal state
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskWord, setTaskWord] = useState<{no:string,en:string}|null>(null);
  const [taskTab, setTaskTab] = useState<"menu"|"write"|"speak"|"answer">("menu");

  // 🔵 NEW: Exercises & evaluation state
  const [exercises, setExercises] = useState<{write:string[], speak:string[], answer:string[]}>({write:[], speak:[], answer:[]});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userText, setUserText] = useState("");
  const [rating, setRating] = useState<{score:number,reason:string}|null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [evalBusy, setEvalBusy] = useState(false);

  // 🔵 NEW: Audio record state
  const [recording, setRecording] = useState<Audio.Recording|null>(null);
  const [micGranted, setMicGranted] = useState<boolean | null>(null);

  useEffect(() => { if (!permission?.granted) requestPermission(); }, [permission]);

  const ensureMic = async () => {
    if (!Audio) {
      Alert.alert("Ikke støttet", "Taleopptak er ikke tilgjengelig på denne plattformen.");
      return;
    }
    const { status } = await Audio.requestPermissionsAsync();
    setMicGranted(status === "granted");
    return status === "granted";
  };

  const flash = () => {
    flashAnim.setValue(1);
    Animated.timing(flashAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
  };

  const onFlip = () => setFacing(f => (f === "front" ? "back" : "front"));

  const startProgress = () => {
    setLoading(true);
    prog.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(prog, { toValue: 0.7, duration: 900, useNativeDriver: false }),
        Animated.timing(prog, { toValue: 1.0, duration: 500, useNativeDriver: false }),
      ])
    ).start();
  };
  const stopProgress = () => {
    Animated.timing(prog, { toValue: 1, duration: 120, useNativeDriver: false }).start(() => {
      setLoading(false);
      prog.setValue(0);
    });
  };

  const takeAndPredict = async () => {
    if (!cameraRef.current || busy) return;
    try {
      setBusy(true);

      // 1) foto
      const photo = await cameraRef.current.takePictureAsync({
        skipProcessing: true,
        quality: JPEG_QUALITY,
        base64: true,
      });

      // 3) resize
      const r = await resizeToMaxSide(photo, MAX_SIDE, JPEG_QUALITY);

      // 4) vis freeze med loading
      setPreviewUri(r.uri);
      setImgW(r.w); setImgH(r.h);
      setBoxes([]);
      flash(); startProgress();

      // 5) kall OpenAI med timeout
      const dets = await callOpenAIWithTimeout(r.b64, MODEL, 15000); // 15s cut
      const px = detectionsToPixels(dets, r.w, r.h);
      setBoxes(px);
    } catch (e) {
      console.warn("predict failed", e);
    } finally {
      stopProgress();
      setBusy(false);
    }
  };

  const closePreview = () => { setPreviewUri(null); setBoxes([]); };

  // -------------------
  // Oversett labels til engelsk via OpenAI (RN-kompatibel)
  const translationCache = useRef(new Map()).current;
  async function translateToEnglish(norsk: string) {
    if (!norsk) return norsk;
    const cached = translationCache.get(norsk);
    if (cached) return cached;

    const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    if (!key) {
      console.warn("Mangler EXPO_PUBLIC_OPENAI_API_KEY");
      return norsk;
    }

    const body = {
      model: "gpt-4o-mini",
      input: `Oversett det norske ordet "${norsk}" til engelsk. Gi bare det korteste og mest vanlige oversettelsesordet. Ikke fantasér. Svar med ett ord.`,
      temperature: 0,
      max_output_tokens: 32, // >=16
    };
    try {
      const rsp = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!rsp.ok) {
        console.warn("Translate failed:", rsp.status, await rsp.text());
        return norsk;
      }
      const json = await rsp.json();
      const out = getOutputText(json) || (json?.output_text ?? "");
      const en = (out || norsk).trim();
      translationCache.set(norsk, en);
      return en;
    } catch (err) {
      console.warn("Translate error:", err);
      return norsk;
    }
  }
  // -------------------

  // Oppdater oversettelser når boxes endres
  useEffect(() => {
    async function updateTranslations() {
      if (boxes.length === 0) {
        setPredictionsWithEn([]);
        return;
      }
      const arr = await Promise.all(
        boxes.map(async b => ({
          ...b,
          en: await translateToEnglish(b.label)
        }))
      );
      setPredictionsWithEn(arr);
    }
    updateTranslations();
  }, [boxes]);

  if (!permission) return <Center><Text>Ber om kameratilgang…</Text></Center>;
  if (!permission.granted) {
    return (
      <Center>
        <Text style={{ color:"#fff", marginBottom:10 }}>Tilgang kreves for kamera</Text>
        <Pressable style={styles.btn} onPress={requestPermission}><Text style={styles.btnTxt}>Tillat</Text></Pressable>
      </Center>
    );
  }

  // scale bokser til skjerm (contain)
  const fit = fitContainScale({ srcW: imgW, srcH: imgH, dstW: SW, dstH: SH });
  const scaled = boxes.map(b => ({
    ...b,
    x1: Math.round(b.x1 * fit.sx + fit.dx),
    y1: Math.max(0, Math.round(b.y1 * fit.sy + fit.dy)),
    x2: Math.round(b.x2 * fit.sx + fit.dx),
    y2: Math.round(b.y2 * fit.sy + fit.dy),
  }));

  const barW = prog.interpolate({ inputRange: [0, 1], outputRange: [0, SW * 0.6] });

  // ---------- UI ----------
  return (
    <View style={styles.root}>
      {/* fullskjerm kamera */}
      <CameraView
        ref={cameraRef}
        style={[StyleSheet.absoluteFill, { transform: [{ scaleX: facing === "front" ? 1 : 1 }] }]} // speil? bytt til -1
        facing={facing}
      />

      {/* frozen preview + overlay */}
      {previewUri && (
        <>
          <Image source={{ uri: previewUri }} resizeMode="contain" style={StyleSheet.absoluteFill} />
          <Svg width={SW} height={SH} style={StyleSheet.absoluteFill}>
            {scaled.map((b, i) => (
              <Rect key={i} x={b.x1} y={b.y1}
                width={Math.max(1, b.x2 - b.x1)} height={Math.max(1, b.y2 - b.y1)}
                stroke="yellow" strokeWidth={3} fill="transparent"
              />
            ))}
          </Svg>
          {scaled.map((b, i) => (
            <View key={`t${i}`} style={[styles.tag, { left: b.x1, top: Math.max(0, b.y1 - 24) }]}>
              {/* fortsatt norsk på overlay; kan bytte til b.en hvis ønsket */}
              <Text style={styles.tagTxt}>{b.label}</Text>
            </View>
          ))}

          {/* loading overlay */}
          {loading && (
            <View style={styles.loadingWrap}>
              <Text style={styles.loadingTxt}>Analyserer…</Text>
              <View style={styles.barBg}>
                <Animated.View style={[styles.barFill, { width: barW }]} />
              </View>
            </View>
          )}

          {/* lukk */}
          <Pressable onPress={closePreview} style={styles.closeBtn}>
            <Text style={styles.closeTxt}>✕</Text>
          </Pressable>
        </>
      )}

      {/* flip (bare i live) */}
      {!previewUri && (
        <Pressable onPress={onFlip} style={styles.flipBtn}>
          <Text style={styles.flipTxt}>{facing === "front" ? "Front" : "Back"}</Text>
        </Pressable>
      )}

      {/* snapshot */}
      <Pressable style={[styles.snapBtn, busy && { opacity: 0.6 }]} onPress={takeAndPredict} disabled={busy}>
        <View style={styles.snapInner} />
      </Pressable>

      {/* flash */}
      <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flashAnim }]} />

      {/* Prediction bar */}
      {predictionsWithEn.length > 0 && (
        <Pressable
          style={[
            styles.predBar,
            barExpanded ? styles.predBarExpanded : styles.predBarCollapsed
          ]}
          onPress={() => setBarExpanded(e => !e)}
        >
          <View style={styles.predList}>
            {predictionsWithEn.map((b, i) => (
              <View key={i} style={styles.predRow}>
                <Text style={styles.predLabel}>{b.label}</Text>
                <Text style={styles.predArrow}>→</Text>
                <Text style={styles.predEn}>{b.en}</Text>

                {/* 🟣 NEW: Task button (erstatter confidence) */}
                <Pressable
                  style={styles.taskBtn}
                  onPress={async () => {
                    setTaskWord({ no: b.label, en: b.en });
                    setTaskTab("menu");
                    setRating(null);
                    setUserText("");
                    setCurrentIndex(0);
                    setExercises({write:[], speak:[], answer:[]});
                    setTaskOpen(true);
                    // pre-generate menu exercises for quick UX if you vil:
                    setGenBusy(true);
                    try {
                      const ex = await generateExercisesForWord(b.label, b.en);
                      setExercises(ex);
                    } catch (e) {
                      console.warn("generateExercisesForWord error", e);
                      Alert.alert("Oops", "Klarte ikke lage oppgaver nå.");
                    } finally {
                      setGenBusy(false);
                    }
                  }}
                >
                  <Text style={styles.taskBtnTxt}>Task</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </Pressable>
      )}

      {/* 🟣 NEW: Fullscreen Task Modal */}
      <Modal visible={taskOpen} animationType="slide" transparent={false}>
        <View style={styles.modalRoot}>
          {/* Close X */}
          <Pressable style={styles.modalClose} onPress={() => setTaskOpen(false)}>
            <Text style={styles.closeTxt}>✕</Text>
          </Pressable>

          {/* Header */}
          <View style={{ paddingTop: 50, paddingHorizontal: 20, paddingBottom: 10 }}>
            <Text style={styles.modalTitle}>What exercises do you want to do with this word?</Text>
            {taskWord && (
              <Text style={styles.modalSub}>
                Norsk: <Text style={{fontWeight:"700"}}>{taskWord.no}</Text>  •  English: <Text style={{fontWeight:"700"}}>{taskWord.en}</Text>
              </Text>
            )}
          </View>

          {taskTab === "menu" && (
            <View style={{ padding: 20 }}>
              {genBusy ? (
                <View style={{alignItems:"center", marginTop:40}}>
                  <ActivityIndicator />
                  <Text style={{color:"#fff", marginTop:10}}>Lager tre oppgaver per kategori…</Text>
                </View>
              ) : (
                <>
                  <BigMenuButton label="Write a Norwegian sentence" onPress={() => { setTaskTab("write"); setCurrentIndex(0); setRating(null); setUserText(""); }} />
                  <BigMenuButton label="Speak a Norwegian sentence" onPress={async () => {
                    const ok = await ensureMic();
                    if (!ok) { Alert.alert("Mikrofon", "Gi tilgang til mikrofon for å bruke tale."); return; }
                    setTaskTab("speak"); setCurrentIndex(0); setRating(null); setUserText("");
                  }} />
                  <BigMenuButton label="Answer a question in Norwegian" onPress={() => { setTaskTab("answer"); setCurrentIndex(0); setRating(null); setUserText(""); }} />
                </>
              )}
            </View>
          )}

          {taskTab !== "menu" && (
            <ScrollView style={{ paddingHorizontal: 20 }} contentContainerStyle={{ paddingBottom: 40 }}>
              <Text style={styles.exerciseHeader}>
                {taskTab === "write" ? "Write a Norwegian sentence" :
                 taskTab === "speak" ? "Speak a Norwegian sentence" :
                 "Answer a question in Norwegian"}
              </Text>

              {/* Oppgavetekst */}
              <Text style={styles.exercisePrompt}>
                {getExercise(exercises, taskTab, currentIndex) ?? "—"}
              </Text>

              {/* INPUT: tekst eller tale */}
              {taskTab === "speak" ? (
                <View style={{ marginTop: 20, alignItems: "center" }}>
                  <Pressable
                    style={[styles.recordBtn, recording && {backgroundColor:"#400"}]}
                    onPress={async () => {
                      if (recording) {
                        try {
                          await recording.stopAndUnloadAsync();
                        } catch {}
                        const rec = recording;
                        setRecording(null);
                        const uri = rec.getURI();
                        if (!uri) { Alert.alert("Opptak", "Fant ikke lydfil."); return; }
                        // Transcribe
                        setEvalBusy(true);
                        try {
                          const transcript = await transcribeAudioWithOpenAI(uri);
                          setUserText(transcript || "");
                        } catch (e) {
                          console.warn("transcribe error", e);
                          Alert.alert("Transkripsjon feilet", "Prøv igjen.");
                        } finally {
                          setEvalBusy(false);
                        }
                      } else {
                        try {
                          await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
                          const rec = new Audio.Recording();
                          await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
                          await rec.startAsync();
                          setRecording(rec);
                        } catch (e) {
                          console.warn("record start error", e);
                          Alert.alert("Opptak feilet", "Kunne ikke starte opptak.");
                        }
                      }
                    }}
                  >
                    <Text style={styles.recordBtnTxt}>{recording ? "Stop & Transcribe" : "Start Recording"}</Text>
                  </Pressable>

                  <Text style={{ color:"#ccc", marginTop: 12, textAlign:"center" }}>
                    {userText ? `Transkripsjon: “${userText}”` : (recording ? "Opptak pågår…" : "Ingen transkripsjon ennå")}
                  </Text>
                </View>
              ) : (
                <>
                  <TextInput
                    value={userText}
                    onChangeText={setUserText}
                    placeholder="Skriv svaret ditt på norsk…"
                    placeholderTextColor="#888"
                    style={styles.input}
                    multiline
                  />
                </>
              )}

              {/* Vurdering */}
              <View style={{ marginTop: 16, flexDirection:"row", gap:12 }}>
                <Pressable
                  style={styles.checkBtn}
                  onPress={async () => {
                    if (!taskWord) return;
                    const prompt = getExercise(exercises, taskTab, currentIndex) ?? "";
                    const answer = userText.trim();
                    if (!answer) { Alert.alert("Svar", "Skriv eller snakk et svar først."); return; }
                    setEvalBusy(true);
                    try {
                      const res = await rateAnswerWithOpenAI(taskWord.no, prompt, answer);
                      setRating(res);
                    } catch (e) {
                      console.warn("rate error", e);
                      Alert.alert("Vurdering feilet", "Prøv igjen.");
                    } finally {
                      setEvalBusy(false);
                    }
                  }}
                >
                  <Text style={styles.checkBtnTxt}>Check</Text>
                </Pressable>

                <Pressable
                  style={styles.nextBtn}
                  onPress={() => {
                    setCurrentIndex(i => Math.min(2, i + 1));
                    setUserText("");
                    setRating(null);
                  }}
                >
                  <Text style={styles.nextBtnTxt}>Next</Text>
                </Pressable>

                <Pressable style={styles.backBtn} onPress={() => setTaskTab("menu")}>
                  <Text style={styles.backBtnTxt}>Back</Text>
                </Pressable>
              </View>

              {evalBusy && (
                <View style={{ marginTop: 16, flexDirection:"row", alignItems:"center", gap:10 }}>
                  <ActivityIndicator />
                  <Text style={{ color:"#fff" }}>Vurderer svaret…</Text>
                </View>
              )}

              {rating && (
                <View style={styles.ratingCard}>
                  <Text style={styles.ratingScore}>Score: {rating.score}/6</Text>
                  <Text style={styles.ratingReason}>{rating.reason}</Text>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

/* ---------- helpers ---------- */

async function resizeToMaxSide(photo, maxSide, quality) {
  const meta = await ImageManipulator.manipulateAsync(photo.uri, [], { compress: 1, base64: false });
  const W = meta.width, H = meta.height;
  const s = Math.min(1, maxSide / Math.max(W, H));
  if (s < 1) {
    const out = await ImageManipulator.manipulateAsync(
      photo.uri,
      [{ resize: { width: Math.round(W * s), height: Math.round(H * s) } }],
      { compress: quality, base64: true }
    );
    return { uri: out.uri, w: out.width, h: out.height, b64: out.base64 };
  }
  if (photo.base64) return { uri: photo.uri, w: W, h: H, b64: photo.base64 };
  const out = await ImageManipulator.manipulateAsync(photo.uri, [], { compress: quality, base64: true });
  return { uri: out.uri, w: W, h: H, b64: out.base64 };
}

async function callOpenAIWithTimeout(b64, model, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await callOpenAI(b64, model, ctrl.signal); }
  finally { clearTimeout(t); }
}

async function callOpenAI(b64, model, signal) {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!key) throw new Error("Mangler EXPO_PUBLIC_OPENAI_API_KEY");

  const body = {
    model,
    temperature: 0.5,
    max_output_tokens: 300,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: PROMPT },
        { type: "input_image", image_url: `data:image/jpeg;base64,${b64}`, detail: "high" },
      ],
    }],
  };

  const rsp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify(body),
    signal,
  });

  if (!rsp.ok) throw new Error(`OpenAI ${rsp.status}: ${await rsp.text()}`);
  const json = await rsp.json();
  const raw = getOutputText(json) || "";
  return parseDetections(raw);
}

function getOutputText(rspJson) {
  if (typeof rspJson.output_text === "string") return rspJson.output_text;
  try {
    const c = rspJson.output?.[0]?.content;
    const p = Array.isArray(c) ? c.find(x => x.type === "output_text" || x.type === "text") : null;
    return p?.text || p?.output_text || "";
  } catch { return ""; }
}

function parseDetections(raw) {
  let data = null;
  try { data = JSON.parse(raw); }
  catch {
    const i = raw.indexOf("{"), j = raw.lastIndexOf("}");
    if (i !== -1 && j !== -1) data = JSON.parse(raw.slice(i, j + 1));
  }
  const arr = data?.detections || [];
  return arr.map(d => {
    const b = d.box_norm; if (!b) return null;
    const clamp = (v,a,b)=>Math.min(Math.max(+v,a),b);
    const xc = clamp(b.xc,0,1), yc = clamp(b.yc,0,1), w = clamp(b.w,0,1), h = clamp(b.h,0,1);
    return { label: d.label_no ?? "objekt", conf: +d.confidence || 0, xc, yc, w, h };
  }).filter(Boolean);
}

function detectionsToPixels(d, W, H) {
  return d.map(o => {
    const x1 = Math.max(0, Math.min(Math.round((o.xc - o.w/2)*W), W-1));
    const y1 = Math.max(0, Math.min(Math.round((o.yc - o.h/2)*H), H-1));
    const x2 = Math.max(0, Math.min(Math.round((o.xc + o.w/2)*W), W-1));
    const y2 = Math.max(0, Math.min(Math.round((o.yc + o.h/2)*H), H-1));
    return { x1, y1, x2, y2, label: o.label, conf: o.conf };
  });
}

function fitContainScale({ srcW, srcH, dstW, dstH }) {
  const s = Math.min(dstW/srcW, dstH/srcH);
  const w = srcW * s, h = srcH * s;
  return { sx: s, sy: s, dx: (dstW - w)/2, dy: (dstH - h)/2 };
}

/* ---------- NEW: Exercise generation & rating ---------- */

async function generateExercisesForWord(norsk: string, english: string) {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!key) throw new Error("Mangler EXPO_PUBLIC_OPENAI_API_KEY");

  const sys = `
Du er en norsk språklærer. Lag korte, konkrete elevoppgaver på A1-A2-nivå (enkelt, naturlig språk). Vær kreativ med oppgavene og inkluder varierte oppgavetyper.
Returner KUN gyldig JSON med:
{"write":["...","...","..."],"speak":["...","...","..."],"answer":["...","...","..."]}

- write: be eleven skrive én norsk setning som bruker ordet naturlig.
- speak: be eleven SI én norsk setning som bruker ordet naturlig (for taleopptak).
- answer: still ett kort spørsmål på norsk som inkluderer ordet.
Oppgavene må være varierte, unike og relevante for ordet.
  `.trim();

  const user = `
Ord (norsk): "${norsk}"
Engelsk: "${english}"
Lag 3 oppgaver per kategori.
  `.trim();

  const body = {
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_output_tokens: 300,
    input: [
      { role: "system", content: [{ type:"input_text", text: sys }] },
      { role: "user", content: [{ type:"input_text", text: user }] }
    ],
  };

  const rsp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!rsp.ok) throw new Error(await rsp.text());
  const json = await rsp.json();
  const out = getOutputText(json) || "{}";
  let data = {};
  try { data = JSON.parse(out); } catch { data = {}; }
  return {
    write: Array.isArray(data.write) ? data.write.slice(0,3) : [],
    speak: Array.isArray(data.speak) ? data.speak.slice(0,3) : [],
    answer: Array.isArray(data.answer) ? data.answer.slice(0,3) : [],
  };
}

async function rateAnswerWithOpenAI(norskOrd: string, prompt: string, userAnswer: string) {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!key) throw new Error("Mangler EXPO_PUBLIC_OPENAI_API_KEY");

  const sys = `
Du er en streng, men rettferdig norsklærer. Vurder elevsvaret KUN basert på oppgaven. Du er ikke streng på teori, KUN språkferdigheter.
Gi poeng 1–6 (heltall) og en kort begrunnelse på norsk (maks 2 setninger).
Returner KUN JSON: {"score":8,"reason":"..."}
  `.trim();

  const user = `
Oppgave: ${prompt}
Ord som skal brukes (norsk): ${norskOrd}
Elevsvar: ${userAnswer}
  `.trim();

  const body = {
    model: "gpt-4o-mini",
    temperature: 0,
    max_output_tokens: 120,
    input: [
      { role: "system", content: [{ type:"input_text", text: sys }] },
      { role: "user", content: [{ type:"input_text", text: user }] }
    ],
  };

  const rsp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!rsp.ok) throw new Error(await rsp.text());
  const json = await rsp.json();
  const out = getOutputText(json) || "{}";
  let d = { score: 0, reason: "Kunne ikke tolke svar." };
  try { d = JSON.parse(out); } catch {}
  return { score: Math.max(1, Math.min(6, d.score|0)), reason: String(d.reason || "") };
}

/* ---------- NEW: Speech-to-text (Whisper) ---------- */

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

/* ---------- small UI helpers ---------- */

function getExercise(ex: {write:string[], speak:string[], answer:string[]}, tab: string, idx: number) {
  const arr = tab === "write" ? ex.write : tab === "speak" ? ex.speak : ex.answer;
  return arr[idx] || null;
}

function Center({ children }) {
  return <View style={{ flex:1, backgroundColor:"#000", alignItems:"center", justifyContent:"center" }}>{children}</View>;
}

function BigMenuButton({ label, onPress }) {
  return (
    <Pressable style={styles.bigBtn} onPress={onPress}>
      <Text style={styles.bigBtnTxt}>{label}</Text>
    </Pressable>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  btn: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#2b6", borderRadius: 8 },
  btnTxt: { color: "white", fontWeight: "700" },

  snapBtn: {
    position: "absolute", bottom: 36, alignSelf: "center",
    width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: "#eee",
    backgroundColor: "#111", alignItems: "center", justifyContent: "center",
  },
  snapInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#e0e0e0" },

  flipBtn: {
    position: "absolute", top: Platform.OS === "ios" ? 50 : 24, right: 16,
    paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 8,
  },
  flipTxt: { color: "#fff", fontWeight: "700" },

  closeBtn: {
    position: "absolute", top: Platform.OS === "ios" ? 50 : 24, left: 16,
    width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
  },
  closeTxt: { color: "#fff", fontSize: 18, fontWeight: "800" },

  flash: { ...StyleSheet.absoluteFillObject, backgroundColor: "white" },

  tag: { position: "absolute", paddingHorizontal: 6, paddingVertical: 3, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 6 },
  tagTxt: { color: "yellow", fontSize: 12, fontWeight: "700" },

  loadingWrap: {
    position: "absolute", left: 0, right: 0, bottom: 120,
    alignItems: "center", justifyContent: "center",
  },
  loadingTxt: { color: "#fff", marginBottom: 8, fontWeight: "600" },
  barBg: {
    width: SW * 0.6, height: 8, borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.2)", overflow: "hidden",
  },
  barFill: { height: 8, backgroundColor: "yellow" },

  predBar: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: "rgba(20,20,20,0.95)",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    zIndex: 10,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 10,
  },
  predBarCollapsed: { bottom: 0, height: "10%" },
  predBarExpanded: { bottom: 0, height: "80%" },
  predList: { flex: 1, justifyContent: "flex-start" },
  predRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  predLabel: { color: "#fff", fontWeight: "700", fontSize: 16, flex: 2 },
  predArrow: { color: "#fff", fontSize: 16, marginHorizontal: 8 },
  predEn: { color: "#aaf", fontWeight: "700", fontSize: 16, flex: 2 },

  // 🟣 NEW:
  taskBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#333", borderRadius: 8, marginLeft: 8 },
  taskBtnTxt: { color: "#fff", fontWeight: "700" },

  // Modal
  modalRoot: { flex:1, backgroundColor:"#000" },
  modalClose: { position:"absolute", top: Platform.OS === "ios" ? 50 : 24, left: 16, zIndex: 20, width:36, height:36, alignItems:"center", justifyContent:"center", backgroundColor:"rgba(255,255,255,0.1)", borderRadius:18 },
  modalTitle: { color:"#fff", fontWeight:"800", fontSize:18 },
  modalSub: { color:"#aaa", marginTop: 6 },

  bigBtn: { backgroundColor:"#1f1f1f", paddingVertical:18, paddingHorizontal:16, borderRadius:12, marginBottom:14, borderWidth:1, borderColor:"#333" },
  bigBtnTxt: { color:"#fff", fontWeight:"700", fontSize:16 },

  exerciseHeader: { color:"#fff", fontWeight:"800", fontSize:17, marginTop: 18, marginBottom: 10 },
  exercisePrompt: { color:"#ddd", fontSize:16, lineHeight:22 },

  input: { marginTop: 16, backgroundColor:"#161616", borderRadius:10, padding:12, color:"#fff", minHeight:80, borderWidth:1, borderColor:"#333" },

  checkBtn: { backgroundColor:"#2b6", paddingHorizontal:16, paddingVertical:10, borderRadius:10 },
  checkBtnTxt: { color:"#fff", fontWeight:"800" },

  nextBtn: { backgroundColor:"#555", paddingHorizontal:16, paddingVertical:10, borderRadius:10 },
  nextBtnTxt: { color:"#fff", fontWeight:"800" },

  backBtn: { backgroundColor:"#333", paddingHorizontal:16, paddingVertical:10, borderRadius:10 },
  backBtnTxt: { color:"#fff", fontWeight:"800" },

  ratingCard: { marginTop: 16, backgroundColor:"#121212", borderRadius:12, padding:12, borderWidth:1, borderColor:"#2a2a2a" },
  ratingScore: { color:"#ff9", fontWeight:"800", marginBottom: 6 },
  ratingReason: { color:"#ddd" },

  // Speak
  recordBtn: { marginTop:16, backgroundColor:"#083", paddingHorizontal:18, paddingVertical:12, borderRadius:12 },
  recordBtnTxt: { color:"#fff", fontWeight:"800" },
});
