// First Step:
  // 1. Show Live Camera ===FINISHED===
  // 2. Take picture with a button ===FINISHED===
  // 3. Show image on screen ===FINISHED===
  // 4. Return to camera by pressing the "X" ===FINISHED===

// Second Step:
  // 1. Make item recognition and print in log ===FINISHED===
  // 2. Add a button to choose from different languages: ===FINISHED===
      // English, Spanish, Polish, italian ===FINISHED===
  // 3. Choose which language to log. output: (norwegian word, chosen language word) ===FINISHED===
  // 4. Add accurate boxes around objects and show them with norwegian label.

// Third Step:
  // 1. Add a modal that user can drag up to see
  // 2. Show both the norwegian word and translated word
  // 3. Add a "read text" speech button. (button, norwegian word, translated word)

// Fourth Step:
  // 1. Add "Task" button on the right of each word
  // 2. Random selection of task (asnwer question, write a sentence, speak out loud, recognize speech with item as subject)
  // 3. Add correct assesment to answer with score from 1-6 and explanation
  // 4. Make a button to make task with two or more items in image

  
  /* #######################################  IMPORTS  ####################################### */
import React, { useRef, useState } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import { View, Text, Pressable, StyleSheet, Animated, Image} from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Image as SvgImage, Rect, Path, Text as SvgText } from "react-native-svg";


/* #######################################  CONSTRAINTS / CONFIG  ####################################### */

const CAMERA_QUALITY = 0.8;
const MAX_SIDE = 640

const MODEL = "gpt-4o-mini"; // What GPT model to use for image detection
const OPENAI_URL = "https://api.openai.com/v1/responses";


const LANGUAGES = [
  { label: "English", code: "en" },
  { label: "Spanish", code: "es" },
  { label: "Polish", code: "pl" },
  { label: "Italian", code: "it"},
  { label: "French", code: "fr"},
  { label: "German", code: "de"},
]

function flagFor(code: string) {
  // Simple Emoji for flag
  const map: Record<string, string> = {
    en: "🇬🇧",
    es: "🇪🇸",
    pl: "🇵🇱",
    it: "🇮🇹",
    fr: "🇫🇷",
    de: "🇩🇪",
  };
  return map[code] ?? "🏳️";
}

const BUBBLE = {
  font: 12,      // tekststørrelse
  padX: 15,      // horisontal padding
  padY: 6,       // vertikal padding
  minW: 70,      // min bredde
  maxW: 240,     // maks bredde
  radius: 8,     // hjørner
  tip: 12,       // lengde på spiss
  stroke: "#3b82f6",
  strokeW: 3,
};

/* #######################################  COMPONENT  ####################################### */

// Main Function
export default function Screen() {

    /* ----------  REFERENCES  ---------- */

  const [detections, setDetections] = useState<Array<{
    label_NO: string; label_TRANS: string;
    confidence: number; cx: number; cy: number; cx_norm: number; cy_norm: number;
  }>>([]);

  const [aiSize, setAiSize] = useState<{w:number; h:number} | null>(null);

  const [busy, setBusy] = useState(false) // Busy State (true/false)

  const [permission, requestPermission] = useCameraPermissions(); // Camera Access
  const cameraRef = useRef<CameraView>(null); // "remote" to camera

  // Preview State
  const [previewUri, setPreviewUri] = useState<string | null>(null); // Saves URI of the captured image

  // Language chosen (use setTargetLang("language_code") to change language)
  const [targetLang, setTargetLang] = useState("en");

  // DEBUGGING
  const startTimeRef = useRef<number | null>(null); // Stopwatch

  /* ----------  HELPER FUNCTIONS  ---------- */


  const logWithTime = (msg: string) => {
    const now = Date.now();
    if (startTimeRef.current === null) {
      startTimeRef.current = now;
    }
    const elapsed = ((now - startTimeRef.current) / 1000).toFixed(3); //seconds
    console.log(`[+${elapsed}s] ${msg}`);
  };

  
  const handleCapture = async () => {
    console.log("PRESSED = Camera_Button")
    if (!cameraRef.current || busy) return; // Return if camera is not ready or busy
    try {
      logWithTime("STARTET = handleCapture")
      setBusy(true); // Set State to busy
      
      // Wait for image to process without lagging
      const photo = await cameraRef.current.takePictureAsync({
        skipProcessing: true,
        quality: CAMERA_QUALITY,
        base64: true,
      });
      
      // Resize Image
      logWithTime("START = Resizing");
      const photo_resized = await resizeToMaxSide(photo.uri, MAX_SIDE, CAMERA_QUALITY)
      logWithTime("END = Resizing");
      setPreviewUri(photo_resized.uri!)
      logWithTime("SENT = Preview")
      setAiSize({ w: photo_resized.width!, h: photo_resized.height! });


      // Send to OpenAI for Object Detection
      logWithTime("START = Object Detection");
      try {
        const prompt = buildVisionPrompt(targetLang, photo_resized.width!, photo_resized.height!);
        logWithTime("FINISHED = Building Prompt")
        const aiText = await callOpenAIWithTimeout(photo_resized.base64!, prompt, 25000);
        logWithTime("FINISHED = Called OpenAI")
        console.log("AI RAW:", aiText);

        const parsed = JSON.parse(aiText);
        const objs = Array.isArray(parsed?.objects) ? parsed.objects : [];
        logWithTime("STARTING = Cleaning JSON")
        const clean = objs.map((o: any) => ({
          label_NO: String(o.label_NO ?? ""),
          label_TRANS: String(o.label_TRANS ?? ""),
          confidence: Number(o.confidence ?? 0),
          cx: Number(o.center_px?.x ?? 0),
          cy: Number(o.center_px?.y ?? 0),
          cx_norm: Number(o.center_norm?.x ?? 0),
          cy_norm: Number(o.center_norm?.y ?? 0),
        })).filter((o:any) => 
          Number.isFinite(o.cx) && Number.isFinite(o.cy)
        );

        setDetections(clean);
        console.log("POINTS:", clean);
      } catch (err) {
        console.log("AI ERROR:", err);
        setDetections([])
      }
      logWithTime("END = Object Detection")


    } catch (e) { // Catch Errors
      console.log("Error Time")
      console.log(e)
    } finally {
      setBusy(false)
      logWithTime("END = Capture")
      startTimeRef.current = null // Reset the timer
    }

  }
  

  /* ----------  MAIN LOGIC  ---------- */

  // 1. Before knowing the permission
  if (!permission) { // if not-permission
    return (
      <Center>
        <Text>Asking For Camera Permission...</Text>
      </Center>
    );
  }

  // 2. No Camera Permission: Show "Ask for Permission" button 
  if (!permission.granted) {
    return console.log("Return = Permission"),(
      <Center>
        <Text style={{ marginBottom: 10 }}>We need access to camera</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnTxt}>Give access</Text>
        </Pressable>
      </Center>
    );
  }

  // 3. If there exist a preview, show it. (runs after taking picture)
  if (previewUri) {
    return console.log("Return = Preview"), (
      <View style={StyleSheet.absoluteFill}>
        {/* Bildevisningen */}
        <Image
          source={{ uri: previewUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />

        {/* 🔹 Detection Bubbles */}
        {aiSize && detections.length > 0 && (
          <Svg
            style={StyleSheet.absoluteFill}
            viewBox={`0 0 ${aiSize.w} ${aiSize.h}`}
          >
            {detections.map((d, i) => {
              const { w, h } = sizeBubble(d.label_NO);
              const bx = d.cx - w / 2;
              const by = d.cy - (h + BUBBLE.tip);

              return (
                <React.Fragment key={i}>
                  {/* Bubble */}
                  <Rect
                    x={bx} y={by} width={w} height={h}
                    rx={BUBBLE.radius} ry={BUBBLE.radius}
                    fill="#fff" stroke={BUBBLE.stroke} strokeWidth={BUBBLE.strokeW}
                  />
                  {/* Tip */}
                  <Path
                    d={`M ${d.cx - 10} ${by + h} L ${d.cx} ${d.cy} L ${d.cx + 10} ${by + h} Z`}
                    fill="#fff" stroke={BUBBLE.stroke} strokeWidth={BUBBLE.strokeW}
                  />
                  {/* Text */}
                  <SvgText
                    x={d.cx}
                    y={by + h / 2 + BUBBLE.font * 0.35}
                    fontSize={BUBBLE.font}
                    fontWeight="600"
                    fill={BUBBLE.stroke}
                    textAnchor="middle"
                  >
                    {d.label_NO.toUpperCase()}
                  </SvgText>
                </React.Fragment>
              );
            })}
          </Svg>
        )}

        {/* Close Button */}
        <Pressable
          style={styles.btnExitPreview}
          onPress={() => {
            setPreviewUri(null);
            setDetections([]); // Empty Detection bubble
          }}
        >
          <MaterialIcons name="close" size={32} color="#fff" />
        </Pressable>
      </View>
    );
  }


  // 4. Given Camera Permission: Show live camera (back)
  console.log("Returned = Screen  |  Language = ", targetLang);
  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        zoom={0.05}
      />
      {/* språkmeny + capture */}
      <ChangeLanguageButton
        languages={LANGUAGES}
        selected={targetLang}
        onSelect={setTargetLang}
      />
      <CaptureButton onPress={handleCapture}/>
    </View>
  );
}


/* #######################################  SUB-COMPONENTS  ####################################### */

// Function to center item in middle of phone screen
function Center({ children }: { children: React.ReactNode }) {
    return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      {children}
    </View>
  );
}

// SNAPSHOT BUTTON STYLE AND ANIMATION
function CaptureButton({ onPress, disabled=false }: { onPress: () => void; disabled?: boolean }) {
  const scale = React.useRef(new Animated.Value(1)).current // Used to scale the snapshot button

  const pressIn = () => {
    console.log("IN = Capture Button");
    Animated.spring(scale, { toValue: 0.90, useNativeDriver: true, speed: 18, bounciness: 6}).start();
  }
  const pressOut = () => {
    console.log("OUT = Capture Button");
    Animated.spring(scale, {toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6}).start();
  }

  return (
    <Animated.View style={[styles.wrap, {transform: [{ scale }]}]}>
      <View style={styles.outerRing}>
        <View style={styles.innerRing}>
          <Pressable
          onPressIn={pressIn}
          onPressOut={pressOut}
          onPress={() => !disabled && onPress()}
          android_ripple={{ color: "#ddd", radius: 44 }}
          style={styles.center}
          />
        </View>
      </View>
    </Animated.View>
  );
}

function ChangeLanguageButton({
  languages,
  selected,
  onSelect,
}: {
  languages: { label: string; code: string }[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const current = languages.find(l => l.code === selected) ?? languages[0];

  return (
    <View style={langStyles.wrap}>
      {/* Hovedknappen */}
      <Pressable style={langStyles.mainBtn} onPress={() => setOpen(o => !o)}>
        <Text style={langStyles.mainTxt}>{flagFor(current.code)}</Text>
      </Pressable>

      {/* Dropdown */}
      {open && (
        <View style={langStyles.dropdown}>
          {languages.map((l) => (
            <Pressable
              key={l.code}
              style={langStyles.item}
              onPress={() => { onSelect(l.code); setOpen(false); }}
            >
              <Text style={langStyles.itemTxt}>
                {flagFor(l.code)}  {l.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}


// ASYNC FUNCTION TO RESIZE IMAGE FOR SENDING TO AI
async function resizeToMaxSide(photoUri: string, maxSide: number, quality: number) {
  // Get image dimensions
  const { width, height } = await ImageManipulator.manipulateAsync(photoUri, []);
  let resize = {};
  if (width > height) {
    resize = { width: maxSide };
  } else {
    resize = { height: maxSide };
  }
  // Resize and compress
  const result = await ImageManipulator.manipulateAsync(
    photoUri,
    [{ resize }],
    { compress: quality, base64: true }
  );
  return result;
}

// Function to get the chosen language into prompt
function getLanguageLabelByCode(code: string) {
  const match = LANGUAGES.find(l => l.code === code);
  return match ? match.label : "English" // English as fallback
}

// Function to build the prompt, with the chosen language
function buildVisionPrompt(code: string, imgW: number, imgH: number) {
  const label = getLanguageLabelByCode(code)
  return `
    You are a fast vision tagger. Find up to 4 clearly visible distinct objects.
    After listing them, translate each word into grammatically correct Norwegian best suited for a non-norwegian speaker.
    Next, translate them again to ${label} in the same manner.

    Return ONLY valid JSON (no prose). Schema:
    {
      "objects": [
        {
          "label_NO": "norwegian word",
          "label_TRANS": "${label} word",
          "confidence": [0,1], 2 decimals of each object
          "center_px": {"x": 123, "y": 456},
          "center_norm": {"x": 0.321, "y": 0.789}
        }
      ]
    }

    Rules:
    - Image size is width=${imgW}, height=${imgH} (pixels). Centers MUST be inside [0,${imgW}] × [0,${imgH}].
    - "center_px" must be integers; "center_norm" must be decimals in [0,1] with 3 decimals.
    - Use grammatically correct Norwegian in label_NO and ${label} in label_TRANS.
    - Confidence in [0,1] with 2 decimals.
    - No trailing commas. No text outside JSON.

    `.trim();
}

// Async funciton to be sure openai can recieve prompt
async function callOpenAIWithTimeout(b64: string, prompt: string, ms: number) {
  const control = new AbortController();
  const timeout = setTimeout(() => control.abort(), ms);
  try {
    return await callOpenAI(b64, prompt, control.signal);
  } finally {
    clearTimeout(timeout);
  }
}

// Function to call OpenAI and get its output text
async function callOpenAI(b64: string, prompt: string, signal?: AbortSignal) {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing EXPO_PUBLIC_OPEN_API_KEY");

  const response = await fetch(OPENAI_URL, { // Sends a HTTP request to OpenAI
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`, // Send API
      "Content-Type": "application/json",  // Tells OpenAI that we send a JSON
    },
    body: JSON.stringify({
      model: MODEL, // Which model to use
      input: [ // What we send to the model. (text prompt, image as b64)
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: `data:image/jpeg;base64,${b64}` },
          ],
        },
      ],
      temperature: 0.1,
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
  return data?.output
    ?.flatMap((msg: any) => msg?.content ?? [])
    ?.filter((p: any) => p?.type === "output_text")
    ?.map((p: any) => p?.text ?? "")
    ?.join("\n")
    ?.trim() ?? "";
}

// Function to size text "bubble" based on text length
function sizeBubble(label: string) {
  const charW = Math.round(BUBBLE.font * 0.55);
  const textW = label.length * charW;
  const w = Math.min(BUBBLE.maxW, Math.max(BUBBLE.minW, textW + 2 * BUBBLE.padX));
  const h = BUBBLE.font + 2 * BUBBLE.padY;
  return { w, h };
}


/* #######################################  STYLES  ####################################### */

const BTN_SIZE = 78;        // Total Size
const BTN_RING_SIZE = 3;    // White Ring Size
const BTN_BLACK_SIZE = 4;   // Black Ring Size
const BTN_BORDER_RADIUS = 3 // Higher => More Squary

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  btn: { backgroundColor: "#2b6", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  btnTxt: { color: "#fff", fontWeight: "700", fontSize: 20, fontFamily: ""},

  // Snapshot Button Style
  wrap: {
    position: "absolute",
    bottom: 36,
    alignSelf: "center",
  },
  outerRing: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / BTN_BORDER_RADIUS,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: BTN_RING_SIZE,
  },
  innerRing: {
    flex: 1,
    width: "100%",
    height: "100%",
    borderRadius: (BTN_SIZE - BTN_BORDER_RADIUS * BTN_RING_SIZE) / BTN_BORDER_RADIUS,
    backgroundColor: "#000",
    padding: BTN_BLACK_SIZE,
  },
  center: {
    flex: 1,
    borderRadius: (BTN_SIZE - BTN_BORDER_RADIUS * (BTN_RING_SIZE + BTN_BLACK_SIZE)) / BTN_BORDER_RADIUS,
    backgroundColor: "#fff",
  },

  // Exit Preview Button
  btnExitPreview: {
    justifyContent: "center",
    alignItems: "center",
    fontSize: 20,
    marginTop: 50,
    marginLeft: 20,
    height: 50,
    width: 50,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.3)",
    backgroundColor: "rgba(0, 0, 0, 0.27)", // 50% transparent green background
  },
  
});

const langStyles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 60,
    right: 20,
    zIndex: 999,
    alignItems: "flex-end",
  },
  mainBtn: {
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  mainTxt: { fontSize: 20, color: "#fff" },
  dropdown: {
    marginTop: 8,
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 12,
    paddingVertical: 6,
    minWidth: 160,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  item: { paddingHorizontal: 12, paddingVertical: 10 },
  itemTxt: { color: "#fff", fontSize: 16 },
});

