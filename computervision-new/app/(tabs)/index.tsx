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
// 4. Add accurate boxes around objects and show them with norwegian label. ===FINISHED===

// Third Step:
// 1. Add a modal that user can drag up to see ===FINISHED===
// 2. Show both the norwegian word and translated word ===FINISHED==
// 3. Add a "read text" speech button. (button, norwegian word, translated word) ===FINISHED===

// Fourth Step:
// 1. Add "Task" button on the right of each word
// 2. Random selection of task (asnwer question, write a sentence, speak out loud, recognize speech with item as subject)
// 3. Add correct assesment to answer with score from 1-6 and explanation
// 4. Make a button to make task with two or more items in image

/* #######################################  IMPORTS  ####################################### */
import ModalSheet from "../../components/ui/ModalSheet";
import { initTTS, speakTTS } from "../../components/tts";
import TaskSheet, { type DetectedItem } from "../../components/ui/TaskSheet";
import { t, languageNameFromCode } from "../../components/i18n";
import { flagFor } from "../../components/flags";

import React, { useRef, useState, useEffect } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import 'react-native-gesture-handler';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Image,
  Dimensions,
  ScrollView,
  ViewStyle,
  StyleProp,
  TextStyle
} from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { MaterialIcons } from "@expo/vector-icons";
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Svg, { Rect, Path, Text as SvgText } from "react-native-svg";

/* #######################################  CONSTRAINTS / CONFIG  ####################################### */

const CAMERA_QUALITY = 0.7;
const MAX_SIDE = 640;

const MODEL = "gpt-4o-mini"; // What GPT model to use for image detection
const OPENAI_URL = "https://api.openai.com/v1/responses";

const LANGUAGES = [
  { label: "English", code: "en" },
  { label: "Spanish", code: "es" },
  { label: "Polish", code: "pl" },
  { label: "Italian", code: "it" },
  { label: "French", code: "fr" },
  { label: "German", code: "de" },
  { label: "Ukrainian", code: "uk" },
  { label: "Hindi", code: "hi" },
  { label: "Urdu", code: "ur" },           // Pakistan
  { label: "Lithuanian", code: "lt" },
  { label: "Chinese (Mandarin)", code: "zh" },
  { label: "Portuguese", code: "pt" },
  { label: "Russian", code: "ru" },
  { label: "Arabic", code: "ar" },
  { label: "Japanese", code: "ja" },
  { label: "Korean", code: "ko" },
  { label: "Turkish", code: "tr" },
  { label: "Dutch", code: "nl" },
  { label: "Swedish", code: "sv" },
  { label: "Danish", code: "da" },
  { label: "Finnish", code: "fi" },
  { label: "Greek", code: "el" },
  { label: "Thai", code: "th" },
  { label: "Vietnamese", code: "vi" },
];

const LEVELS = [
  "A1",
  "A2",
  "B1",
  "B2"
];

const BUBBLE = {
  font: 12, // tekststørrelse
  padX: 15, // horisontal padding
  padY: 6, // vertikal padding
  minW: 70, // min bredde
  maxW: 240, // maks bredde
  radius: 8, // hjørner
  tip: 12, // lengde på spiss
  stroke: "#3b82f6",
  strokeW: 3,
};


/* #######################################  COMPONENT  ####################################### */

// Main Function
export default function Screen() {
  /* ----------  REFERENCES  ---------- */

  const [detections, setDetections] = useState<
    Array<{
      desc_NO: any;
      desc_TRANS: any;
      label_NO: string;
      label_TRANS: string;
      confidence: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      cx: number;
      cy: number;
    }>
  >([]);

  // AI Image Size
  const [aiSize, setAiSize] = useState<{ w: number; h: number } | null>(null);

  // Flash Effect
  const flashAnim = useRef(new Animated.Value(0)).current; // Animation for flash effect, returns: value from 0 to 1

  // Loading bar
  const [loading, setLoading] = useState(false); // Loading state for the loading bar (true/false)
  const prog = useRef(new Animated.Value(0)).current; // number from 0 to 1 for progress bar animation (0 empty, 1 full)
  const SW = Dimensions.get("window").width; // Screen Width
  const barW = prog.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SW * 0.6],
  }); // Width of loading bar based on prog value

  const [busy, setBusy] = useState(false); // Busy State (true/false)

  const [permission, requestPermission] = useCameraPermissions(); // Camera Access
  const cameraRef = useRef<CameraView>(null); // "remote" to camera

  // Preview State
  const [previewUri, setPreviewUri] = useState<string | null>(null); // Saves URI of the captured image

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);

  // Task State
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskItem, setTaskItem] = useState<DetectedItem | null>(null);

  //Button Click Animation
  const buttonAnim = useRef(new Animated.Value(1)).current;

  // Language chosen (use setTargetLang("language_code") to change language)
  const [targetLang, setTargetLang] = useState("en");

  // Diff Level chosen
  const [targetLevel, setTargetLevel] = useState("A1")

  useEffect(() => { initTTS(); }, []);

  const [canScroll, setCanScroll] = React.useState(false);

  const handleProgress = (p: number) => {
    setCanScroll(p < 0.2); //0: full open, 1: peek
  };

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

  // Flash
  const flash = () => {
    flashAnim.setValue(1);
    Animated.timing(flashAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(); //Fade out (duration 150ms)
  };


  // Loading bar animations
  const startProgress = () => {
    // Start loading bar animation
    setLoading(true); // Set loading state to true
    prog.setValue(0); // Reset progress to 0
    Animated.loop(
      // Loop the animation from here
      Animated.sequence([
        // Sequence of animations
        Animated.timing(prog, {
          toValue: 0.7,
          duration: 900,
          useNativeDriver: false,
        }), // Animate from 0% to 70% in 900ms
        Animated.timing(prog, {
          toValue: 1.0,
          duration: 500,
          useNativeDriver: false,
        }), // Animate from 70% to 100% in 500ms
      ])
    ).start(); // Start the animation loop
  };
  const stopProgress = () => {
    // Stop loading bar animation
    Animated.timing(prog, {
      toValue: 1,
      duration: 120,
      useNativeDriver: false,
    }).start(() => {
      // Animate from current value to 100% in 120ms
      setLoading(false); // Set loading state to false
      prog.setValue(0); // Reset progress to 0
    });
  };

  type TTSButtonProps = {
    onPress: () => void;

    // Show MaterialIcon?
    showIcon?: bool;
    iconLibrary?: "MaterialIcons" | "FontAwesome5";
    // MaterialIcon Name?
    iconName?: keyof typeof MaterialIcons.glyphMap | string;
    iconSize?: number;
    iconColor?: string;

    // Show Text Label? (ignored if passed children)
    showText?: boolean;
    text?: string;
    textStyle?: StyleProp<TextStyle>;

    // Optional Style for the outer Button
    style?: StyleProp<ViewStyle>;

    // Optional custom content; if provided ovverrides ShowIcon/Showtext
    children?: React.ReactNode;
  };

  function TTSButton({
    onPress,
    showIcon = false,
    iconLibrary = "MaterialIcons",
    iconName = "multitrack-audio",
    iconSize = 20,
    iconColor = "#fff",
    showText = false,
    text = "",
    textStyle,
    style,
    children,
  }: TTSButtonProps) {
    const scale = useRef(new Animated.Value(1)).current;

    const onPressIn = () => {
      Animated.spring(scale, {
        toValue: 1.06, // Little Bigger
        useNativeDriver: true,
        speed: 18,
        bounciness: 6,
      }).start();
    };

    const onPressOut = () => {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 18,
        bounciness: 6,
      }).start();
    };
    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          onPress={onPress}
          style={[
            {

            },
            style,
          ]}
          >
            {children ? (
              children
            ) : (
              <>
                {showIcon && (
                  <>
                    {iconLibrary === "FontAwesome5" ? (
                      <FontAwesome5 name={iconName as any} size={iconSize} color={iconColor} />
                    ) : (
                      <MaterialIcons name={iconName as any} size={iconSize} color={iconColor} />
                    )}
                  </>
                )}
                {showText && !!text && (
                  <Text style={[{ color: "#fff", fontWeight: "600" }, textStyle]}>{text}</Text>
                )}
              </>
            )}
          </Pressable>
        </Animated.View>
      );
    }

  const handleCapture = async () => {
    console.log("Camera Capture Pressed");
    if (!cameraRef.current || busy) return; // Return if camera is not ready or busy
    try {
      logWithTime("Started Handling Capture");
      setBusy(true); // Set State to busy

      // Wait for image to process without lagging
      const photo = await cameraRef.current.takePictureAsync({
        skipProcessing: true,
        quality: CAMERA_QUALITY,
        base64: true,
      });
      
      // Resize Image
      logWithTime("Resizing..");
      const photo_resized = await resizeToMaxSide(
        photo.uri,
        MAX_SIDE,
        CAMERA_QUALITY
      );
      logWithTime("Finished Resizing");
      setPreviewUri(photo.uri!);
      logWithTime("Preview Set");

      // Flash Effect
      flash();
      startProgress(); // Start flash and loading bar

      setAiSize({ w: photo_resized.width!, h: photo_resized.height! }); // Set AI image size for SVG

      // Send to OpenAI for Object Detection
      logWithTime("Started Object Detection");
      try {
        const label = getLanguageLabelByCode(targetLang);
        const prompt = buildVisionPrompt(
          photo_resized.width!,
          photo_resized.height!,
          label,
          targetLevel
        );
        logWithTime("Prompt Built");
        const aiText = await callOpenAIWithTimeout(
          photo_resized.base64!,
          prompt,
          25000
        );
        logWithTime("OpenAI Response Received");
        console.log("AI RAW:", aiText); // Debug: show raw AI output

        // Parse AI Output and convert to pixel boxes
        const parsed = JSON.parse(aiText);
        const objs = Array.isArray(parsed?.objects) ? parsed.objects : [];

        const px = objs
          .map((o: any) => {
            const bn = o?.box_norm || {};
            const clamp = (v: number, a: number, b: number) =>
              Math.min(Math.max(+v, a), b);
            const xc = clamp(bn.xc, 0, 1),
              yc = clamp(bn.yc, 0, 1),
              w = clamp(bn.w, 0, 1),
              h = clamp(bn.h, 0, 1);
            const x1 = Math.max(
              0,
              Math.min(
                Math.round((xc - w / 2) * photo_resized.width!),
                photo_resized.width! - 1
              )
            );
            const y1 = Math.max(
              0,
              Math.min(
                Math.round((yc - h / 2) * photo_resized.height!),
                photo_resized.height! - 1
              )
            );
            const x2 = Math.max(
              0,
              Math.min(
                Math.round((xc + w / 2) * photo_resized.width!),
                photo_resized.width! - 1
              )
            );
            const y2 = Math.max(
              0,
              Math.min(
                Math.round((yc + h / 2) * photo_resized.height!),
                photo_resized.height! - 1
              )
            );
            const cx = Math.round((x1 + x2) / 2);
            const cy = Math.round((y1 + y2) / 2);
            return {
              label_NO: String(o.label_NO || ""),
              label_TRANS: String(o.label_TRANS || ""),
              desc_NO: String(o.desc_NO || ""),
              desc_TRANS: String(o.desc_TRANS || ""),
              confidence: Number(o.confidence || 0),
              x1,
              y1,
              x2,
              y2,
              cx,
              cy,
            };
          })
          .filter((d: any) => d.x2 > d.x1 && d.y2 > d.y1);

        setDetections(px);
        logWithTime(`DETECTIONS = ${px.length} objects detected`); // Log number of detections

        setModalOpen(true); // Open modal with vocabulary

        logWithTime("Finished Object Detection");
      } catch (err: any) {
        console.error("Error during AI processing:", err);
        setDetections([]); // Empty detections on error
        stopProgress(); // Stop loading bar on error
      }
    } catch (err: any) {
      console.error("Error during capture:", err);
    } finally {
      setBusy(false);
      stopProgress(); // Stop loading bar
      logWithTime("Finished Handling Capture");
      startTimeRef.current = null; // Reset stopwatch
    }
  };

  /* ----------  MAIN LOGIC  ---------- */

  // 1. Before knowing the permission
  if (!permission) {
    // if not-permission
    return (
      <Center>
        <Text>{t(targetLang, "askCamPerm")}</Text>
      </Center>
    );
  }

  // 2. No Camera Permission: Show "Ask for Permission" button
  if (!permission.granted) {
    return (
      console.log("Return = Permission"),
      (
        <Center>
          <Text style={{ marginBottom: 10 }}>We need access to camera</Text>
          <Pressable style={styles.btn} onPress={requestPermission}>
            <Text style={styles.btnTxt}>{t(targetLang, "giveAccess")}</Text>
          </Pressable>
        </Center>
      )
    );
  }

  // 3. If there exist a preview, show it. (runs after taking picture)
  if (previewUri) {
    return (
      console.log("Return = Preview"),
      (
        <View style={StyleSheet.absoluteFill}>
          {/* Image Preview */}
          <Image
            source={{ uri: previewUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
          />
          <Text style={styles.imageOverlayText}>*Marker position may not be correct*</Text>
          {/* Detection Bubbles (center of each detection box) */}
          {aiSize && detections.length > 0 && (
            <Svg
              style={StyleSheet.absoluteFill}
              viewBox={`0 0 ${aiSize.w} ${aiSize.h}`}
            >
              {detections.map((det, i) => {
                const { w, h } = sizeBubble(det.label_NO); // Calculate bubble size based on label
                const bx = det.cx - w / 2; // bubble x (centered)
                const above = det.cy > h + BUBBLE.tip + 6; // place bubble above if enough space
                const by = above
                  ? det.cy - (h + BUBBLE.tip)
                  : det.cy + BUBBLE.tip; // bubble y (above or below)
                const tipPath = above
                  ? `M ${det.cx - 10} ${by + h} L ${det.cx} ${det.cy} L ${
                      det.cx + 10
                    } ${by + h} Z`
                  : `M ${det.cx - 10} ${by} L ${det.cx} ${det.cy} L ${
                      det.cx + 10
                    } ${by} Z`;

                return (
                  <React.Fragment key={i}>
                    {/* debug rectangle around the object, comment in if needed */}
                    {/* <Rect x={det.x1} y={det.y1} width={det.x2-det.x1} height={det.y2-det.y1} stroke="#ff0" strokeWidth={2} fill="transparent" /> */}

                    {/* Bubble */}
                    <Rect
                      x={bx}
                      y={by}
                      width={w}
                      height={h}
                      rx={BUBBLE.radius}
                      ry={BUBBLE.radius}
                      fill="#fff"
                      stroke={BUBBLE.stroke}
                      strokeWidth={BUBBLE.strokeW}
                    />
                    {/* Tip */}
                    <Path
                      d={tipPath}
                      fill="#fff"
                      stroke={BUBBLE.stroke}
                      strokeWidth={BUBBLE.strokeW}
                    />
                    {/* Text */}
                    <SvgText
                      x={det.cx}
                      y={by + h / 2 + BUBBLE.font * 0.35}
                      fontSize={BUBBLE.font}
                      fontWeight="600"
                      fill={BUBBLE.stroke}
                      textAnchor="middle"
                    >
                      {det.label_NO.toUpperCase()}
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
              setModalOpen(false);
            }}
          >
            <MaterialIcons name="close" size={32} color="#fff" />
          </Pressable>

          {/* flash */}
          <Animated.View
            pointerEvents="none"
            style={[styles.flash, { opacity: flashAnim }]}
          />

          {/* Loading Bar */}
          {loading && (
            <View style={styles.loadingWrap}>
              <Text style={styles.loadingTxt}>{t(targetLang, "processing")}</Text>
              <View style={styles.loadingBarBg}>
                <Animated.View style={[styles.barFill, { width: barW }]} />
              </View>
            </View>
          )}
          {/* ========================== MODAL SHEET ========================== */}
          <ModalSheet
            // Controls whether the modal is open or not
            open={modalOpen}
            // Called whenever modal is dragged up or down
            onChange={setModalOpen}
            // How much of the modal is visible in its "peek" position (10%)
            peekRatio={0.12}
            // How far you must drag up before it snaps fully open (30%)
            snapUpThreshold={0.3}
            // How far you must drag down before it snaps closed (30%)
            snapDownThreshold={0.3}
            // Disable full close (modal always stays visible at least in peek state)
            canClose={false}
            onProgress={handleProgress}
          >
            {/* ==================== SCROLLABLE CONTENT AREA ==================== */}
            <ScrollView
              // Allow vertical scrolling when there are many detected items
              style={{ flex: 1 }}
              // Add internal padding to prevent content from sticking to edges
              contentContainerStyle={{
                paddingTop: 10,
                paddingBottom: 300, // extra space at bottom so last card isn't cut off
              }}
              // Hide default iOS/Android scrollbar for a cleaner look
              showsVerticalScrollIndicator={false}
              scrollEnabled={canScroll}
            >
              {/* ==================== WRAPPER FOR DETECTION CARDS ==================== */}
              <View style={styles.detectionsWrap}>
                {/* Title shown at the top of the modal */}
                <Text style={styles.title}>{t(targetLang, "itemsDetected")}</Text>

                {/* Map over all AI detections and render one card per object */}
                {detections.map((det, i) => (
                  <View key={i} style={styles.itemCard}>
                    {/* ==================== MAIN ROW: WORDS + BUTTONS ==================== */}
                    <View style={styles.itemRow}>
                      {/* LEFT SIDE: detected object in Norwegian + translated word */}
                      <View style={styles.itemTextWrap}>
                        <Text style={styles.itemLabel}>
                          {det.label_NO.charAt(0).toUpperCase() + det.label_NO.slice(1)}
                        </Text>
                        <Text style={styles.itemTranslation}>
                          {det.label_TRANS.charAt(0).toUpperCase() + det.label_TRANS.slice(1)}
                        </Text>
                      </View>

                      {/* RIGHT SIDE: action buttons for TTS and Task */}
                      <View style={styles.buttonRow}>
                        {/* Text-to-speech (plays the Norwegian label) */}
                        <TTSButton
                          onPress={() => speakTTS(det.label_NO, "no")}
                          showIcon={true}
                          iconName="multitrack-audio"
                          style={styles.ttsButton}
                        />
                        {/* Future Task button (can open exercises or extra info) */}
                        <TTSButton
                          onPress={() => {
                            setTaskItem(det);
                            setTaskOpen(true);
                          }}
                          showIcon={true}
                          iconLibrary="FontAwesome5"
                          iconName="tasks"
                          style={styles.ttsButton}
                          />
                      </View>
                    </View>

                    {/* ==================== FOOTER ROW: DESCRIPTIONS ==================== */}
                    <View style={styles.descRow}>
                      {/* Left chip: short Norwegian description of object position */}
                      <View style={styles.descChip}>
                        <TTSButton
                          onPress={() => speakTTS(det.desc_NO, "no")}
                          showText
                          text={`🇳🇴 ${det.desc_NO}`}   // <-- bruk template string, ikke "… {det.desc_NO}"
                          textStyle={styles.descChipText}
                        />
                      </View>

                      {/* Right chip: translated description in chosen target language */}
                      <View style={styles.descChip}>
                        <TTSButton
                          onPress={() => speakTTS(det.desc_TRANS, "else")}
                          showText
                          text={`${flagFor(targetLang)} ${det.desc_TRANS}`}   // <-- bruk template string, ikke "… {det.desc_NO}"
                          textStyle={styles.descChipText}
                        />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
          </ModalSheet>
          <TaskSheet
            visible={taskOpen}
            onClose={() => setTaskOpen(false)}
            item={taskItem}
            targetLang={targetLang}
            level={targetLevel as "A1" | "A2" | "B1" | "B2"}
            speak={(t, lang) => speakTTS(t, lang)}
            onStartTask={(it, { level, lang }) => {
              // TODO: start oppgaveflyt her
              console.log("Start task for:", it.label_NO, level, lang);
            }}
          />
        </View>
      )
    );
  }

  // 4. Given Camera Permission: Show live camera (back)
  console.log("Returned = Screen  |  Language = ", targetLang, "  |  Level = ", targetLevel);
  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        zoom={0.001}
      />
      {/* språkmeny + capture */}
      <ChangeLanguageButton
        languages={LANGUAGES}
        selected={targetLang}
        onSelect={setTargetLang}
      />
      <ChangeDiffButton
        levels={LEVELS}
        selected_level={targetLevel}
        onSelect={setTargetLevel}
        targetLang={targetLang}
      />
      <CaptureButton onPress={handleCapture} />
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
function CaptureButton({
  onPress,
  disabled = false,
}: {
  onPress: () => void;
  disabled?: boolean;
}) {
  const scale = React.useRef(new Animated.Value(1)).current; // Used to scale the snapshot button

  const pressIn = () => {
    console.log("IN = Capture Button");
    Animated.spring(scale, {
      toValue: 0.9,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
  };
  const pressOut = () => {
    console.log("OUT = Capture Button");
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
  };

  return (
    <Animated.View style={[styles.wrap, { transform: [{ scale }] }]}>
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

// ----- LANGUAGE SELECT DROPDOWN BUTTON -------
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
  const current = languages.find((l) => l.code === selected) ?? languages[0];

  return (
    <View style={langStyles.wrap}>
      {/* Hovedknappen */}
      <Pressable style={langStyles.mainBtn} onPress={() => setOpen((o) => !o)}>
        <Text style={langStyles.mainTxt}>{flagFor(current.code)}</Text>
      </Pressable>

      {/* Dropdown */}
      {open && (
        <>
          {/* Press outside = close */}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            
          <View style={langStyles.dropdown}>
            <ScrollView
              style={{ maxHeight: 260 }}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {languages.map((l) => (
                <Pressable
                  key={l.code}
                  style={langStyles.item}
                  onPress={() => {
                    onSelect(l.code);
                    setOpen(false);
                  }}
                >
                  <Text style={langStyles.itemTxt}>
                    {flagFor(l.code)} {l.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </>
      )}
    </View>
  );
}


// FUNCTION TO CHANGE DIFFICULTY
function ChangeDiffButton ({
  levels,
  selected_level,
  onSelect,
  targetLang,
}: {
  levels: string[];
  selected_level: string;
  onSelect: (code: string) => void;
  targetLang: string;
}) {
  const [open, setOpen] = React.useState(false);
  const current = levels.find((l) => l === selected_level) ?? levels[0];


  return (
    <View style={langStyles.wrapLevel}>
      {/* Hovedknappen */}
      <Pressable style={langStyles.mainBtn} onPress={() => setOpen((o) => !o)}>
        <Text style={langStyles.mainTxt}>{current}</Text>
      </Pressable>

      {/* Dropdown */}
      {open && (
        <>
          {/*Close when pressing outside*/}
          <Pressable
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            onPress={() => setOpen(false)}
          />
          <View style={langStyles.dropdown}>
            <Text style={{
              color: "#fff",
              marginLeft: 8,
              marginRight: 8,
              fontWeight: "800",
              fontSize: 14,
              letterSpacing: 0.5
              
              
            }}>{t(targetLang, "languageLevels")}</Text>
            {levels.map((l) => (
              <Pressable
              key={l}
              style={langStyles.item}
              onPress={() => {
               onSelect(l);
                setOpen(false);
              }}
              >
                <Text style={langStyles.itemTxt}>
                  {l}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

// ASYNC FUNCTION TO RESIZE IMAGE FOR SENDING TO AI
async function resizeToMaxSide(
  photoUri: string,
  maxSide: number,
  quality: number
) {
  // Get image dimensions
  const { width, height } = await ImageManipulator.manipulateAsync(
    photoUri,
    []
  );
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
  const match = LANGUAGES.find((l) => l.code === code);
  return match ? match.label : "English"; // English as fallback
}

// 🔄 CHANGED: Build prompt to request NORMALIZED boxes (like code 1)
function buildVisionPrompt(imgW: number, imgH: number, label: string, level: string) {
  return `
Return ONLY valid JSON, no prose.

Detect maximum 5 clearly visible distinct objects in the image and output:
{
  "objects": [
    {
      "label_NO": "...",
      "label_TRANS": "...",
      "desc_NO": "...",        // ≤8 words
      "desc_TRANS": "...",     // ≤8 words
      "confidence": 0.95,                // 2 decimals [0,1]
      "box_norm": { "xc": 0.5000, "yc": 0.5000, "w": 0.3000, "h": 0.4000 } // normalized to [0,1]
    }
  ]
}

Learner level (CEFR): ${level} (A1, A2, B1, B2).

Level adaptation rules:
- A1: use very common, simple nouns; desc phrases with 3-5 very basic words.
- A2: slightly more specific nouns; simple modifiers allowed; desc up to 6-7 words.
- B1: specific, concrete nouns; allow compound nouns; desc can include simple prepositional detail.
- B2: most precise/technical everyday nouns; prefer compound nouns over generic terms; desc may include relational/contrast detail—still minimum 8 words.
- Difficulty increases with level for both label_NO/label_TRANS choice and desc phrasing; all other rules below still apply.

Rules:
- Image size: width=${imgW}, height=${imgH} px; but return boxes normalized [0,1].
- xc,yc are the box center; w,h are width/height; 4 decimals; clamp inside [0,1].
- Be creative and realistic when generating box coordinates — avoid round or repetitive values; use natural-looking decimals like 0.5346 or 0.2783 for variety and precision.
- Boxes must tightly cover the visible object (avoid background).
- Sort objects by confidence descending.
- No trailing commas. Only JSON.

Rules for labels:
- Use specific, concrete nouns that match what a human would say when pointing at it in real life.
- Prefer more informative words over generic ones (e.g., “energidrikk” over “boks”).
- Avoid vague terms like “ting”, “objekt”, “produkt”.
- label_NO must be in Norwegian and reflect level ${level}.
- label_TRANS must be the same word in ${label}, reflecting ${level}.
- Keep it 1-2 words max.
- Do not invent brand names unless it's the only clear identifier.

Rules for an extra learning phrase:
- Add "desc_NO": one short Norwegian phrase (max 8 words) describing what/where the object is in THIS image; adjust complexity to ${level}.
- Also try to explain objects beside it if possible.
- No brand names unless obviously visible.
- No commas, no periods, no capitalization rules—just a phrase (e.g., "energidrikk på bordet").
- Also add "desc_TRANS": same phrase in ${label} (max 8 words), matching ${level}.
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
        // What we send to the model. (text prompt, image as b64)
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${b64}`,
              detail: "low",
            },
          ],
        },
      ],
      temperature: 0,
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

// Function to size text "bubble" based on text length
function sizeBubble(label: string) {
  const charW = Math.round(BUBBLE.font * 0.55);
  const textW = label.length * charW;
  const w = Math.min(
    BUBBLE.maxW,
    Math.max(BUBBLE.minW, textW + 2 * BUBBLE.padX)
  );
  const h = BUBBLE.font + 2 * BUBBLE.padY;
  return { w, h };
}


/* #######################################  STYLES  ####################################### */

const BTN_SIZE = 78; // Total Size
const BTN_RING_SIZE = 3; // White Ring Size
const BTN_BLACK_SIZE = 4; // Black Ring Size
const BTN_BORDER_RADIUS = 3; // Higher => More Squary

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  btn: {
    backgroundColor: "#2b6",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnTxt: { color: "#fff", fontWeight: "700", fontSize: 20, fontFamily: "" },

  // Flash Style
  flash: { ...StyleSheet.absoluteFillObject, backgroundColor: "white" },

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
    borderRadius:
      (BTN_SIZE - BTN_BORDER_RADIUS * BTN_RING_SIZE) / BTN_BORDER_RADIUS,
    backgroundColor: "#000",
    padding: BTN_BLACK_SIZE,
  },
  center: {
    flex: 1,
    borderRadius:
      (BTN_SIZE - BTN_BORDER_RADIUS * (BTN_RING_SIZE + BTN_BLACK_SIZE)) /
      BTN_BORDER_RADIUS,
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
  imageOverlayText: {
    alignItems: "center",
    justifyContent: "center",
    position: "absolute",
    top: 60,
    textAlign: "center",
    width: "100%",
    color: "#000000ff",
    fontSize: 12,
    fontWeight: "400",
    fontStyle: "italic",
    opacity: 0.7,
  },

  // Loading Bar Styles
  loadingWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 120,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  loadingTxt: {
    color: "#fff",
    marginBottom: 8,
    fontWeight: "600",
    fontSize: 16,
    backgroundColor: "#000000ff",
    borderRadius: 6,
    padding: 10
  },
  loadingBarBg: {
    width: "70%",
    height: 8,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.2)",
    overflow: "hidden",
  },
  barFill: {
    height: 8,
    backgroundColor: "#3b82f6",
  },
  detectionsWrap: {
    paddingBottom: 32,
  },
  title: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 18,
    marginBottom: 16,
    textAlign: "center",
    letterSpacing: 0.5,
  },
  itemCard: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  itemTextWrap: {
    flex: 1,
    marginRight: 10,
  },
  itemLabel: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  itemTranslation: {
    color: "#bbb",
    fontSize: 13,
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 8,
  },
  listenText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  descRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  descChip: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  descChipText: {
    color: "#ddd",
    fontSize: 12,
    fontStyle: "italic",
  },
  ttsButton: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 40, // valgfritt
    minHeight: 36,
  },
  btnContainer: {
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  blueBg: {
    backgroundColor: "#3b82f6", // base blå
    borderRadius: 8,
  },
  whiteBg: {
    backgroundColor: "#fff", // base blå
    borderRadius: 8,
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

  // Level
    wrapLevel: {
    position: "relative",
    top: 60,
    right: 80,
    zIndex: 999,
    alignItems: "flex-end",
  },
});
