/**
 * Text-to-Speech helper that streams audio from ElevenLabs and plays it via Expo AV.
 * Provides initialization helpers plus a convenience wrapper for playing prompts.
 */

import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { encode as btoa } from "base-64";

const DEFAULT_VOICE_ID = "4kCDY3HJwvO7Zp3con83";
const DEFAULT_VOICE_ID_NO = "xF681s0UeE04gsf0mVsJ";
const DEFAULT_MODEL_ID = "eleven_turbo_v2_5";
const DEFAULT_MODEL_ID_NO = "eleven_turbo_v2_5";
// Helge: vUmLiNBm6MDcy1NUHaVr
// Dennis: s2xtA7B2CTXPPlJzch1v
// Sebastian: 4kCDY3HJwvO7Zp3con83
// British Nathaniel: Wq15xSaY3gWvazBRaGEU

let initialized = false;
let busy = false;
let soundRef: Audio.Sound | null = null;

/**
 * Prepares the Expo AV layer so speech can play even in silent mode.
 */
export async function initTTS() {
  if (initialized) return;
  // Keep playback consistent and avoid OS ducking/earpiece routing
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    allowsRecordingIOS: false,
    staysActiveInBackground: false,
    playThroughEarpieceAndroid: false,
    shouldDuckAndroid: false,
  });
  initialized = true;
}

/**
 * Streams TTS audio from ElevenLabs and plays it. Ensures only one
 * request runs at a time to avoid overlapping audio.
 */
export async function speakTTS(
  speaktext: string,
  language: string,
  opts?: {
    apiKey?: string;
    voiceId?: string;
    modelId?: string;
  }
) {
  if (!speaktext?.trim()) return;
  if (busy) return;
  busy = true;

  const apiKey =
    opts?.apiKey ?? (process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY as string);
  if (!apiKey) {
    busy = false;
    throw new Error("Missing EXPO_PUBLIC_ELEVENLABS_API_KEY");
  }

  try {
    console.log("Saying:", speaktext)
    // Reassert playback-friendly audio mode in case the app changed it elsewhere
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: false,
      staysActiveInBackground: false,
      playThroughEarpieceAndroid: false,
      shouldDuckAndroid: false,
    });

    const voiceId =
      opts?.voiceId ??
      (language === "no" ? DEFAULT_VOICE_ID_NO : DEFAULT_VOICE_ID);
    const modelId =
      opts?.modelId ??
      (language === "no" ? DEFAULT_MODEL_ID_NO : DEFAULT_MODEL_ID);

    // No prefix; previous hint was being spoken aloud by the model
    const langPrefix = "";

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          accept: "audio/mpeg",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: `${langPrefix}${speaktext}`,
          model_id: modelId, // e.g. "eleven_v3" or "eleven_turbo_v2_5"
          voice_settings: {
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`TTS ${res.status}: ${errBody}`);
    }

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const base64 = (global as any).btoa ? (global as any).btoa(bin) : btoa(bin);

    const fileUri = FileSystem.cacheDirectory + "tts.mp3";
    await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: "base64" });

    const { sound } = await Audio.Sound.createAsync({ uri: fileUri });
    if (soundRef) await soundRef.unloadAsync().catch(() => {});
    soundRef = sound;

    sound.setOnPlaybackStatusUpdate((s) => {
      if ("isLoaded" in s && s.isLoaded && s.didJustFinish && !s.isPlaying) {
        sound.unloadAsync().catch(() => {});
        soundRef = null;
      }
    });

    await sound.setIsMutedAsync(false);
    await sound.setVolumeAsync(1.0);
    await sound.playAsync();
    console.log("Stopped speaking")
  } finally {
    busy = false;
  }
}
