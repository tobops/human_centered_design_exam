// First Step:
  // 1. Show Live Camera ===FINISHED===
  // 2. Take picture with a button
  // 3. Show image on screen
  // 4. Return to camera by pressing the "X"

  
  /* #######################################  IMPORTS  ####################################### */
import React, { useRef, useState } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import { View, Text, Pressable, StyleSheet, Animated, Image} from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { MaterialIcons } from '@expo/vector-icons';




/* #######################################  CONSTRAINTS / CONFIG  ####################################### */

const CAMERA_QUALITY = 0.8;
const MAX_SIDE = 768

/* #######################################  COMPONENT  ####################################### */

// Main Function
export default function Screen() {

  const [busy, setBusy] = useState(false) // Busy State (true/false)

  const [permission, requestPermission] = useCameraPermissions(); // Camera Access
  const cameraRef = useRef<CameraView>(null); // "remote" to camera

  // Preview State
  const [previewUri, setPreviewUri] = useState<string | null>(null); // Saves URI of the captured image

  // DEBUGGING
  const startTimeRef = useRef<number | null>(null); // Stopwatch

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
      setPreviewUri(photo.uri)
      logWithTime("SENT = Preview")

      // Resize Image
      logWithTime("START = Resizing");
      const photo_resized = await resizeToMaxSide(photo.uri, MAX_SIDE, CAMERA_QUALITY)
      logWithTime("END = Resizing");

    } catch (e) { // Catch Errors
      console.log("Error Time")
      console.log(e)
    } finally {
      setBusy(false)
      logWithTime("END = Capture")
      startTimeRef.current = null // Reset the timer
    }

  }
  

  // Logic for Camera

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
    return console.log("Return = Preview"),(
      <View style={StyleSheet.absoluteFill}>
        <Image
          source={{ uri: previewUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />
        <Pressable style={styles.btnExitPreview} onPress={() => setPreviewUri(null)}>
          <MaterialIcons name="close" size={32} color="#fff" />
        </Pressable>
      </View>
    )
  }

  // 4. Given Camera Permission: Show live camera (back)
  return console.log("Returned = Screen"),(
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        zoom={0.05}
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

/* #######################################  HELPER FUNCTIONS  ####################################### */


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
    borderColor: "#000",
    backgroundColor: "rgba(0, 0, 0, 0.27)", // 50% transparent green background
    
    
  }
});

