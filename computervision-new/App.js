import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Dimensions, Animated, Platform } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import Svg, { Rect } from "react-native-svg";

const MODEL = "gpt-4o-mini";            // evt "o4-mini"
const SNAP_MAX_SIDE = 640;              // samsvarer med Python-koden
const JPEG_QUALITY = 0.8;               // 0–1 i RN
const PROMPT = `
Finn opptil 5 tydelige objekter. Svar KUN som gyldig JSON:
{"detections":[{"label_no":"person","confidence":0.95,
"box_norm":{"xc":0.50,"yc":0.50,"w":0.30,"h":0.40}}]}
Regler:
- Bruk KORTE norske navn i 'label_no', men vær spesifikk når mulig (f.eks. 'snusboks', 'energidrikk', 'plante', 'sokk').
- Returner normaliserte bokser i 'box_norm' relativt til bildet jeg sendte (0–1).
- Boksen skal ligge STRAMT rundt objektets synlige kontur (maks ~5% margin).
- Dropp objekter du er usikre på i stedet for å gjette.
`;

const { width: SCREEN_W } = Dimensions.get("window");
const PREVIEW_ASPECT = 4 / 3; // Expo Camera 640x480-aktig
const PREVIEW_W = SCREEN_W;
const PREVIEW_H = Math.round(PREVIEW_W * (1 / PREVIEW_ASPECT)); // 3/4 høyde

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const [boxes, setBoxes] = useState([]);  // [{x1,y1,x2,y2,label,conf}]
  const [busy, setBusy] = useState(false);
  const flashAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission]);

  const flash = () => {
    flashAnim.setValue(1);
    Animated.timing(flashAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
  };

  const takeAndPredict = async () => {
    if (!cameraRef.current || busy) return;
    try {
      setBusy(true);

      // 1) Ta bilde (front-kamera er speilet i view; selve bildet er IKKE speilet → vi flipper)
      const photo = await cameraRef.current.takePictureAsync({
        skipProcessing: true,
        quality: JPEG_QUALITY,
        base64: true,
      });

      // 2) Mirror (horisontal flip) for å matche det du ser
      const flipped = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ flip: ImageManipulator.FlipType.Horizontal }],
        { compress: JPEG_QUALITY, base64: true }
      );

      // 3) Resize til SNAP_MAX_SIDE
      const { resizedUri, resizedW, resizedH, b64 } = await resizeToMaxSide(flipped, SNAP_MAX_SIDE, JPEG_QUALITY);

      // 4) Send til OpenAI
      const detections = await callOpenAI(b64, MODEL);

      // 5) Konverter norm-bokser til piksler i *resized*-bildet
      const pxBoxes = detectionsToPixels(detections, resizedW, resizedH);

      // 6) Skaler videre til overlay-størrelse (vi tegner i kamera-preview sin størrelse)
      const scale = fitContainScale({ srcW: resizedW, srcH: resizedH, dstW: PREVIEW_W, dstH: PREVIEW_H });
      const scaled = pxBoxes.map(b => ({
        ...b,
        x1: Math.round(b.x1 * scale.sx + scale.dx),
        y1: Math.round(b.y1 * scale.sy + scale.dy),
        x2: Math.round(b.x2 * scale.sx + scale.dx),
        y2: Math.round(b.y2 * scale.sy + scale.dy),
      }));
      setBoxes(scaled);

      // 7) Flash-effekt
      flash();
    } catch (e) {
      console.warn("predict failed", e);
    } finally {
      setBusy(false);
    }
  };

  if (!permission) return <View style={styles.center}><Text>Ber om kameratilgang…</Text></View>;
  if (!permission.granted) return (
    <View style={styles.center}>
      <Text>Tilgang kreves for kamera</Text>
      <Pressable style={styles.btn} onPress={requestPermission}><Text style={styles.btnTxt}>Tillat</Text></Pressable>
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.previewWrap}>
        {/* Speilet forhåndsvisning */}
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="front"
        />
        {/* Mirror selve previewen (ikke bildet vi sender) */}
        <View style={[StyleSheet.absoluteFill, { transform: [{ scaleX: -1 }] }]} />

        {/* SVG-bokser */}
        <Svg width={PREVIEW_W} height={PREVIEW_H} style={styles.svg}>
          {boxes.map((b, i) => (
            <Rect
              key={i}
              x={b.x1}
              y={b.y1}
              width={Math.max(1, b.x2 - b.x1)}
              height={Math.max(1, b.y2 - b.y1)}
              stroke="yellow"
              strokeWidth={2}
              fill="transparent"
            />
          ))}
        </Svg>

        {/* Labels (enkelt, topp-venstre på hver boks) */}
        {boxes.map((b, i) => (
          <View key={`t${i}`} style={[styles.tag, { left: b.x1, top: Math.max(0, b.y1 - 20) }]}>
            <Text style={styles.tagTxt}>
              {b.label} {(b.conf ?? 0).toFixed(2)}
            </Text>
          </View>
        ))}

        {/* Flash overlay */}
        <Animated.View pointerEvents="none"
          style={[styles.flash, { opacity: flashAnim }]}
        />
      </View>

      {/* Snapshot-knapp */}
      <Pressable style={[styles.snapBtn, busy && { opacity: 0.6 }]} onPress={takeAndPredict} disabled={busy}>
        <View style={styles.snapInner}/>
      </Pressable>

      <Text style={styles.hint}>
        Trykk på knappen for å ta speilet snapshot → sender til {MODEL} → tegner bokser
      </Text>
    </View>
  );
}

/* ---------------- helpers ---------------- */

async function resizeToMaxSide(photo, maxSide, quality) {
  // photo: { uri, width?, height?, base64? }
  // Vi henter dims via manipulator (stabilt på alle plattformer)
  const meta = await ImageManipulator.manipulateAsync(photo.uri, [], { compress: 1, base64: false });
  const W = meta.width, H = meta.height;
  const scale = Math.min(1, maxSide / Math.max(W, H));
  let resizedUri = photo.uri, resizedW = W, resizedH = H;

  if (scale < 1) {
    const out = await ImageManipulator.manipulateAsync(
      photo.uri,
      [{ resize: { width: Math.round(W * scale), height: Math.round(H * scale) } }],
      { compress: quality, base64: true }
    );
    resizedUri = out.uri;
    resizedW = out.width;
    resizedH = out.height;
    return { resizedUri, resizedW, resizedH, b64: out.base64 };
  } else {
    // allerede innenfor – men sørg for base64
    if (photo.base64) return { resizedUri, resizedW, resizedH, b64: photo.base64 };
    const out = await ImageManipulator.manipulateAsync(photo.uri, [], { compress: quality, base64: true });
    return { resizedUri, resizedW, resizedH, b64: out.base64 };
  }
}

async function callOpenAI(b64, model) {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!key) throw new Error("Mangler EXPO_PUBLIC_OPENAI_API_KEY");

  const body = {
    model,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: PROMPT },
        { type: "input_image", image_url: `data:image/jpeg;base64,${b64}` },
      ],
    }],
  };

  const rsp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!rsp.ok) {
    const txt = await rsp.text();
    throw new Error(`OpenAI error ${rsp.status}: ${txt}`);
  }

  const json = await rsp.json();
  // Prøv å hente plain text-respons
  const raw = getOutputText(json) || "";
  return parseDetections(raw);
}

function getOutputText(rspJson) {
  // Responses API varierer litt – prøv "output_text", ellers aggregator
  if (typeof rspJson.output_text === "string") return rspJson.output_text;
  // fallback: finn første text i output
  try {
    const c = rspJson.output?.[0]?.content;
    const piece = Array.isArray(c) ? c.find(p => p.type === "output_text" || p.type === "text") : null;
    return piece?.text || piece?.output_text || "";
  } catch { return ""; }
}

function parseDetections(raw) {
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    const i = raw.indexOf("{"), j = raw.lastIndexOf("}");
    if (i !== -1 && j !== -1) data = JSON.parse(raw.slice(i, j + 1));
  }
  const arr = data?.detections || [];
  return arr
    .map(d => {
      const b = d.box_norm;
      if (!b) return null;
      const xc = clamp(+b.xc, 0, 1), yc = clamp(+b.yc, 0, 1),
            w = clamp(+b.w, 0, 1),  h = clamp(+b.h, 0, 1);
      return {
        label: d.label_no ?? "objekt",
        conf: +d.confidence || 0,
        xc, yc, w, h
      };
    })
    .filter(Boolean);
}

function detectionsToPixels(detections, W, H) {
  return detections.map(d => {
    const x1 = Math.max(0, Math.min(Math.round((d.xc - d.w / 2) * W), W - 1));
    const y1 = Math.max(0, Math.min(Math.round((d.yc - d.h / 2) * H), H - 1));
    const x2 = Math.max(0, Math.min(Math.round((d.xc + d.w / 2) * W), W - 1));
    const y2 = Math.max(0, Math.min(Math.round((d.yc + d.h / 2) * H), H - 1));
    return { x1, y1, x2, y2, label: d.label, conf: d.conf };
  });
}

function fitContainScale({ srcW, srcH, dstW, dstH }) {
  const sx = dstW / srcW, sy = dstH / srcH;
  const s = Math.min(sx, sy);
  const w = srcW * s, h = srcH * s;
  const dx = (dstW - w) / 2, dy = (dstH - h) / 2;
  return { sx: s, sy: s, dx, dy };
}

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

/* ---------------- styles ---------------- */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0b0c", alignItems: "center", paddingTop: Platform.OS === "ios" ? 50 : 30 },
  previewWrap: {
    width: PREVIEW_W,
    height: PREVIEW_H,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  camera: { width: PREVIEW_W, height: PREVIEW_H },
  svg: { position: "absolute", left: 0, top: 0 },
  tag: {
    position: "absolute",
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 6,
  },
  tagTxt: { color: "yellow", fontSize: 12, fontWeight: "600" },
  flash: { ...StyleSheet.absoluteFillObject, backgroundColor: "white" },
  snapBtn: {
    marginTop: 18,
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: "#ddd",
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#111",
  },
  snapInner: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: "#e0e0e0",
  },
  btn: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#2b6", borderRadius: 8 },
  btnTxt: { color: "white", fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  hint: { marginTop: 10, color: "#aaa" },
});
