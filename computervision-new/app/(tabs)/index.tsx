// First Step:
  // 1. Show Live Camera ===FINISHED===
  // 2. Take picture with a button
  // 3. Show image on screen
  // 4. Return to camera by pressing the "X"

  
  /* #######################################  IMPORTS  ####################################### */
import React, { useRef } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import { View, Text, Pressable, StyleSheet, Animated} from "react-native";


/* #######################################  CONSTRAINTS / CONFIG  ####################################### */

const CAMERA_QUALITY = 0.8;

/* #######################################  COMPONENT  ####################################### */


export default function CameraBasic() {
  const [permission, requestPermission] = useCameraPermissions(); // Camera Access
  const cameraRef = useRef<CameraView>(null); // "remote" to camera

  const handleCapture = async () => {
    console.log("Button Pressed")
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
    return (
      <Center>
        <Text style={{ marginBottom: 10 }}>We need access to camera</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnTxt}>Give access</Text>
        </Pressable>
      </Center>
    );
  }

  // 2. Given Camera Permission: Show live camera (back)
  return (
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

  const pressIn = () => Animated.spring(scale, { toValue: 0.90, useNativeDriver: true, speed: 18, bounciness: 6}).start()
  const pressOut = () => Animated.spring(scale, {toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6}).start()
  return (
    <Animated.View style={[styles.wrap, animStyle]}>
      <View style={styles.outerRing}>
        <View style={styles.innerRing}>
          <Pressable
          onPressIn={pressIn}
          onPressOut={pressOut}
          onPress={!disabled ? onPress : undefined}
          android_ripple={{ color: "#ddd", radius: 44 }}
          style={styles.center}
          />
        </View>
      </View>
    </Animated.View>
  );
}


/* #######################################  STYLES  ####################################### */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  btn: { backgroundColor: "#2b6", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  btnTxt: { color: "#fff", fontWeight: "700"},

  // Snapshot Button Style
  wrap: {
    position: "absolute"
  }
});

