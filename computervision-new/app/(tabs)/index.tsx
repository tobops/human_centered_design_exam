// @ts-nocheck
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Dimensions, Animated, Platform, Image } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import Svg, { Rect } from "react-native-svg";

const MODEL = "gpt-4.1-mini";        // mer presis: "o4-mini" (tregere)
const MAX_SIDE = 768;               // 512 = raskere / 960 = mer nøyaktig
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

UNIVERSELLE PRINSIPPER (generalisert, ikke domenespesifikke)
1) Fysikalitet først: Merk bare **fysiske** objekter i scenen. Alt som kun er representert som bilde, video, refleksjon, skygge, speilning eller på en skjerm/poster ignoreres. Merk da selve bæreren (fysisk enhet), ikke innholdet.
2) Objektprioritet: Prioriter nærliggende, tydelig avgrensede objekter foran store bakgrunner. Nær-/forgrunn > fjern-/bakgrunn når du velger topp 5.
3) Stramhet vs. avkutt: Boksene skal følge synlig kontur med mål <3% ekstra margin. Dersom valget står mellom å **kutte** objektet eller å inkludere litt bakgrunn: velg **svakt for stor** (heller litt for stor enn litt for liten).
4) Anti-megaboks: Én boks = én sammenhengende gjenstand. Ikke lag bokser som dekker flere separate objekter eller store scenesegmenter.
5) Skala-robusthet: Søk i flere skalaer. Kandidater helt ned til ~3% av bildeflaten skal vurderes. Behold små objekter når de er tydelig avgrenset.
6) Occlusion/truncation: Delvis skjulte eller avkuttede objekter kan merkes hvis identiteten er tydelig. Boks følger kun den **synlige** delen.
7) Konsistenskontroll: Justér boks til sannsynlige kanter (edge-snap). Unngå ekstremt ulogiske aspektforhold for kjente formfaktorer. Klipp til bildekant; ingen verdier <0 eller >1.
8) Duplikathåndtering: Slå sammen overlappende kandidater (IoU>0.60). Behold den med høyest presisjon (mest stram) og høyest confidence.
9) Kalibrering: Senk confidence ved sterk bevegelsesuskarphet, lav kontrast, ekstrem vinkel eller tett bakgrunnsblanding. Øk moderat ved klare kanter og konsistente konturer.
10) Navneregler: Bruk naturlig, spesifikt norsk ord fremfor superkategori. Ingen merkenavn/modeller. Små bokstaver, ingen mellomrom dersom sammensatt.

VALIDERING FØR SVAR
- Tall ∈ [0,1]? Avrunding riktig?
- Boksene stramme (mål <3%) og ikke avkuttende? Hvis i tvil: litt for store.
- Ingen megabokser / ett-objekt-per-boks?
- Maks 5, sortert på confidence?

Returner deretter KUN JSON i skjemaet over.
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

  useEffect(() => { if (!permission?.granted) requestPermission(); }, [permission]);

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

      // 2) speil om front
      let base = photo;
      if (facing === "front") {
        base = await ImageManipulator.manipulateAsync(
          photo.uri,
          [{ flip: ImageManipulator.FlipType.Horizontal }],
          { compress: JPEG_QUALITY, base64: true }
        );
      }

      // 3) resize
      const r = await resizeToMaxSide(base, MAX_SIDE, JPEG_QUALITY);

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
    y1: Math.round(b.y1 * fit.sy + fit.dy),
    x2: Math.round(b.x2 * fit.sx + fit.dx),
    y2: Math.round(b.y2 * fit.sy + fit.dy),
  }));

  const barW = prog.interpolate({ inputRange: [0, 1], outputRange: [0, SW * 0.6] });

  return (
    <View style={styles.root}>
      {/* fullskjerm kamera */}
      <CameraView
        ref={cameraRef}
        style={[StyleSheet.absoluteFill, { transform: [{ scaleX: facing === "front" ? -1 : 1 }] }]}
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
              <Text style={styles.tagTxt}>{b.label} {(b.conf ?? 0).toFixed(2)}</Text>
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
  temperature: 0, // mer deterministisk
  max_output_tokens: 300,
  input: [{
    role: "user",
    content: [
      { type: "input_text", text: PROMPT },
      { 
        type: "input_image",
        image_url: `data:image/jpeg;base64,${b64}`,
        detail: "high" 
      },
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
});

function Center({ children }) {
  return <View style={{ flex:1, backgroundColor:"#000", alignItems:"center", justifyContent:"center" }}>{children}</View>;
}
