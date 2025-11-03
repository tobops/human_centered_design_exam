import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { encode as btoa } from "base-64";

const DEFAULT_VOICE_ID = "4kCDY3HJwvO7Zp3con83";
const DEFAULT_MODEL_ID = "eleven_v3";
// Helge: vUmLiNBm6MDcy1NUHaVr
// Dennis: s2xtA7B2CTXPPlJzch1v
// Sebastian: 4kCDY3HJwvO7Zp3con83
// British Nathaniel: Wq15xSaY3gWvazBRaGEU

let initialized = false;
let busy = false;
let soundRef: Audio.Sound | null = null;

export async function initTTS() {
  if (initialized) return;
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  initialized = true;
}

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
    const voiceId = opts?.voiceId ?? DEFAULT_VOICE_ID;
    const modelId = opts?.modelId ?? DEFAULT_MODEL_ID;

    const prompts = {
      no: "[snakk sakte og tydelig på norsk] ",
      else: "[speak slow and clearly in the written language] ",
    };

    const prompt = prompts[language as keyof typeof prompts];

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
          text: prompt + speaktext,
          model_id: modelId, // e.g. "eleven_v3" or "eleven_multilingual_v2"
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
  } finally {
    busy = false;
  }
}
