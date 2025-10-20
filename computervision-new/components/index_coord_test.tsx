// app/(tabs)/index_coord_test.tsx  (or any screen you like)

import React, { useEffect, useState } from "react";
import { View, Pressable, Text, StyleSheet, ActivityIndicator } from "react-native";
import Svg, { Image as SvgImage, Rect, Path, Text as SvgText } from "react-native-svg";
import * as ImageManipulator from "expo-image-manipulator";
import { Asset } from "expo-asset";

/* =================== Config =================== */

const MODEL = "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/responses";

// resize budget (keeps latency low)
const MAX_SIDE = 712;
const JPEG_Q = 0.8;

// UI bubble style
const BUBBLE = {
  font: 14,
  padX: 10,
  padY: 6,
  minW: 80,
  maxW: 240,
  radius: 8,
  tip: 12,
  stroke: "#3b82f6",
  strokeW: 3,
};

// ⬇️ change to your asset
const TEST_IMG = require("../../assets/images/fotball.jpg");

/* =================== Types =================== */

type Det = {
  label: string;
  confidence: number;
  cx: number;
  cy: number;
  box?: { x: number; y: number; w: number; h: number };
};

type Tile = {
  name: string; // e.g. "FULL" or "G_2_3"
  b64: string; w: number; h: number; ox: number; oy: number;
};

/* =================== Helpers =================== */

function sizeBubble(label: string) {
  const charW = Math.round(BUBBLE.font * 0.55);
  const textW = label.length * charW;
  const w = Math.min(BUBBLE.maxW, Math.max(BUBBLE.minW, textW + 2 * BUBBLE.padX));
  const h = BUBBLE.font + 2 * BUBBLE.padY;
  return { w, h };
}

// resize any uri to MAX_SIDE, baking EXIF orientation with rotate:0
async function resizeAny(uri: string, targetMaxSide = MAX_SIDE, quality = JPEG_Q) {
  const meta = await ImageManipulator.manipulateAsync(uri, [], { compress: 1 });
  const resize =
    (meta.width ?? 0) >= (meta.height ?? 0)
      ? { width: targetMaxSide }
      : { height: targetMaxSide };

  const out = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize }, { rotate: 0 }],
    { compress: quality, base64: true, format: ImageManipulator.SaveFormat.JPEG }
  );
  return out; // {uri, width, height, base64}
}

// REPLACE entire function with this:
async function makeGridTiles(
  fullUri: string,
  gridCols = 3,
  gridRows = 3,
  fullSide = 448,
  tileSide = 256,
  jpegQ = 0.75
) {
  const meta = await ImageManipulator.manipulateAsync(fullUri, [], { compress: 1 });
  const W = meta.width!, H = meta.height!;
  const cellW = Math.floor(W / gridCols);
  const cellH = Math.floor(H / gridRows);

  // FULL reference
  const FULLr = await resizeAny(fullUri, fullSide, jpegQ);
  const FULL: Tile = { name: "FULL", b64: FULLr.base64!, w: FULLr.width!, h: FULLr.height!, ox: 0, oy: 0 };

  // grid tiles
  const TILES: Tile[] = [];
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const ox = c * cellW;
      const oy = r * cellH;
      const w = (c === gridCols - 1) ? (W - ox) : cellW;
      const h = (r === gridRows - 1) ? (H - oy) : cellH;

      const cut = await ImageManipulator.manipulateAsync(
        fullUri,
        [{ crop: { originX: ox, originY: oy, width: w, height: h } }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );
      const rsz = await resizeAny(cut.uri, tileSide, jpegQ);
      TILES.push({ name: `G_${r + 1}_${c + 1}`, b64: rsz.base64!, w: rsz.width!, h: rsz.height!, ox, oy });
    }
  }

  return { FULL, TILES, fullResized: FULLr };
}


// REPLACE with:
function buildGridPrompt(fullW: number, fullH: number, tiles: Tile[]) {
  const meta = tiles.map(t =>
    `${t.name}: origin=(${t.ox},${t.oy}) in FULL px; resized tile size=${t.w}x${t.h}`
  ).join("\n");

  return `
Return ONLY valid JSON, no prose.

You are given multiple views of the SAME scene:
- FULL image: size=${fullW}x${fullH} px (this is the ONLY output coordinate system)
- NxN grid tiles to refine boundaries:
${meta}

Task:
- Detect maximum 5 clearly visible distinct objects.
- Use the tiles to refine tight boxes and precise centers.
- OUTPUT all coordinates in FULL pixel space.

Schema:
{
  "objects": [
    {
      "label": "bicycle",
      "confidence": 0.93,
      "box_px": {"x": 160, "y": 90, "w": 220, "h": 180},
      "center_px": {"x": 270, "y": 180}
    }
  ]
}

Rules:
- Confidence in [0,1] with 2 decimals.
- Centers MUST equal the geometric center of your box.
- Keep all coords within [0,${fullW}] × [0,${fullH}].
- No trailing commas. Only JSON.
`.trim();
}

async function callOpenAI(body: any, signal?: AbortSignal) {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing EXPO_PUBLIC_OPENAI_API_KEY");

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${t}`);
  }
  const data = await res.json();
  const textOut =
    data?.output?.flatMap((m: any) => m?.content ?? [])
      ?.filter((p: any) => p?.type === "output_text")
      ?.map((p: any) => p?.text ?? "")
      ?.join("\n")
      ?.trim() ?? "";
  return textOut;
}

// REPLACE entire function with:
async function detectWithGrid(fullUri: string) {
  // tune here if you want: more/less tiles & sizes
  const GRID_COLS = 6, GRID_ROWS = 6;
  const FULL_SIDE = 448, TILE_SIDE = 256, JPEGQ = 0.75;

  const { FULL, TILES, fullResized } = await makeGridTiles(
    fullUri, GRID_COLS, GRID_ROWS, FULL_SIDE, TILE_SIDE, JPEGQ
  );

  const prompt = buildGridPrompt(fullResized.width!, fullResized.height!, TILES);

  const body = {
    model: MODEL,
    temperature: 0,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        { type: "input_image", image_url: `data:image/jpeg;base64,${FULL.b64}`, detail: "low" },
        ...TILES.map(t => ({ type: "input_image", image_url: `data:image/jpeg;base64,${t.b64}`, detail: "low" })),
      ],
    }],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.EXPO_PUBLIC_OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const textOut =
    data?.output?.flatMap((m: any) => m?.content ?? [])
      ?.filter((p: any) => p?.type === "output_text")
      ?.map((p: any) => p?.text ?? "")
      ?.join("\n")
      ?.trim() ?? "";

  const parsed = JSON.parse(textOut);
  const objs = Array.isArray(parsed?.objects) ? parsed.objects : [];

  const dets: Det[] = objs.map((o: any) => {
    const x = Number(o.box_px?.x ?? 0), y = Number(o.box_px?.y ?? 0);
    const w = Number(o.box_px?.w ?? 0), h = Number(o.box_px?.h ?? 0);
    const cx = (w > 0 && h > 0) ? Math.round(x + w / 2) : Number(o.center_px?.x ?? 0);
    const cy = (w > 0 && h > 0) ? Math.round(y + h / 2) : Number(o.center_px?.y ?? 0);
    return { label: String(o.label ?? ""), confidence: Number(o.confidence ?? 0), cx, cy,
      box: (w > 0 && h > 0) ? { x, y, w, h } : undefined };
  }).filter(d => Number.isFinite(d.cx) && Number.isFinite(d.cy));

  return { dets, displayUri: fullResized.uri!, displayW: fullResized.width!, displayH: fullResized.height! };
}

/* =================== Component =================== */

export default function VisionPyramidScreen() {
  const [imgUri, setImgUri] = useState<string | null>(null);
  const [aiSize, setAiSize] = useState<{ w: number; h: number } | null>(null);
  const [detections, setDetections] = useState<Det[]>([]);
  const [busy, setBusy] = useState(false);

  // load test image once
  useEffect(() => {
    (async () => {
      const asset = Asset.fromModule(TEST_IMG);
      await asset.downloadAsync();
      setImgUri(asset.localUri || asset.uri);
    })();
  }, []);

  const onDetect = async () => {
    if (!imgUri || busy) return;
    setBusy(true);
    try {
      const { dets, displayUri, displayW, displayH } = await detectWithGrid(imgUri);
      setImgUri(displayUri);
      setAiSize({ w: displayW, h: displayH });
      setDetections(dets);
    } catch (e) {
      console.warn("detect error:", e);
      setDetections([]);
    } finally {
      setBusy(false);
    }
  };

  if (!imgUri) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ color: "#fff", marginTop: 8 }}>Loading image…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {aiSize ? (
        <Svg style={styles.svg} viewBox={`0 0 ${aiSize.w} ${aiSize.h}`} preserveAspectRatio="xMidYMid meet">
          <SvgImage href={{ uri: imgUri }} x={0} y={0} width={aiSize.w} height={aiSize.h} />
          {detections.map((d, i) => {
            const { w, h } = sizeBubble(d.label || "item");
            const above = d.cy > (h + BUBBLE.tip + 6);
            const bx = d.cx - w / 2;
            const by = above ? d.cy - (h + BUBBLE.tip) : d.cy + BUBBLE.tip;
            const tipPath = above
              ? `M ${d.cx - 10} ${by + h} L ${d.cx} ${d.cy} L ${d.cx + 10} ${by + h} Z`
              : `M ${d.cx - 10} ${by} L ${d.cx} ${d.cy} L ${d.cx + 10} ${by} Z`;

            return (
              <React.Fragment key={i}>
                <Rect
                  x={bx} y={by} width={w} height={h}
                  rx={BUBBLE.radius} ry={BUBBLE.radius}
                  fill="#fff" stroke={BUBBLE.stroke} strokeWidth={BUBBLE.strokeW}
                />
                <Path d={tipPath} fill="#fff" stroke={BUBBLE.stroke} strokeWidth={BUBBLE.strokeW} />
                <SvgText
                  x={d.cx}
                  y={by + h / 2 + BUBBLE.font * 0.35}
                  fontSize={BUBBLE.font}
                  fontWeight="600"
                  fill={BUBBLE.stroke}
                  textAnchor="middle"
                >
                  {(d.label || "ITEM").toUpperCase()}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      ) : (
        <View style={styles.flex} />
      )}

      <Pressable style={[styles.btn, busy && { opacity: 0.6 }]} onPress={onDetect} disabled={busy}>
        <Text style={styles.btnTxt}>{busy ? "Detecting…" : "Detect objects"}</Text>
      </Pressable>
    </View>
  );
}

/* =================== Styles =================== */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  svg: { flex: 1, width: "100%", height: "100%" },
  btn: {
    position: "absolute",
    bottom: 24,
    alignSelf: "center",
    backgroundColor: "#3b82f6",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
  },
  btnTxt: { color: "#fff", fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  flex: { flex: 1 },
});
