/**
 * ModalSheet
 * ----------
 * Reanimated bottom sheet component that supports peek/expanded states,
 * drag gestures, and progress callbacks for embedding custom content.
 */
import React, { useEffect } from "react";
import { StyleSheet, View, Dimensions, Pressable } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
  useAnimatedReaction,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

type Props = {
  open: boolean;
  onChange: (v: boolean) => void;

  /** Portion of the sheet visible in the peek state (0.12 = 12% of the screen) */
  peekRatio?: number;                 // default 0.12
  /** How far upward the user must drag before snapping fully open (0..1) */
  snapUpThreshold?: number;           // default 0.35
  /** How far downward the user must drag before snapping back to peek (0..1) */
  snapDownThreshold?: number;         // default 0.35
  /** Velocity (px/s) that overrides position and forces a snap */
  velocityThreshold?: number;         // default 1000
  /** Spring feel */
  springStiffness?: number;           // default 220
  springDamping?: number;             // default 22
  /** Allow the sheet to close completely when pulled past the peek point? */
  canClose?: boolean;                 // default false
  /** Optional top inset when fully open (e.g., safe-area padding) */
  topInset?: number;                  // default 0
  /** progress callback (0 = fully open, 1 = at peek; >1 when moving towards closed) */
  onProgress?: (progress: number) => void;

  children?: React.ReactNode;
};

/**
 * Declarative bottom sheet that animates between peek and expanded states,
 * exposing plenty of knobs (springs, thresholds, insets) for the parent screen.
 */
export default function ModalSheet({
  open,
  onChange,
  peekRatio = 0.12,
  snapUpThreshold = 0.35,
  snapDownThreshold = 0.35,
  velocityThreshold = 2000,
  springStiffness = 500,
  springDamping = 60,
  canClose = false,
  topInset = 300,
  onProgress,
  children,
}: Props) {
  const { height: SCREEN_H } = Dimensions.get("window");

  // Y=0 means fully open (at the top). Y increases as the sheet moves downward.
  const FULL_OPEN_Y = topInset;                   // fully open position
  const PEEK_Y = SCREEN_H * (1 - peekRatio);     // collapsed position
  const CLOSED_Y = SCREEN_H;                      // completely hidden
  const translateY = useSharedValue(CLOSED_Y);

  // Respond to the controlled `open` prop
  useEffect(() => {
    if (open) {
      translateY.value = withSpring(PEEK_Y, { stiffness: springStiffness, damping: springDamping });
    } else {
      translateY.value = withTiming(CLOSED_Y, { duration: 200 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, PEEK_Y, CLOSED_Y, springStiffness, springDamping]);

  // Drag gesture configuration
  const pan = Gesture.Pan()
    .onChange((e) => {
      const next = translateY.value + e.changeY;
      const lower = FULL_OPEN_Y;
      const upper = canClose ? CLOSED_Y : PEEK_Y;
      translateY.value = Math.max(lower, Math.min(next, upper));
    })
    .onEnd((e) => {
      const y = translateY.value;
      const v = e.velocityY; // + ned, - opp
      const span = PEEK_Y - FULL_OPEN_Y; // > 0
      const progress = (y - FULL_OPEN_Y) / Math.max(1, span); // 0..1(+)

      // Fart over terskel → snap
      if (v <= -velocityThreshold) {
        translateY.value = withSpring(FULL_OPEN_Y, { stiffness: springStiffness, damping: springDamping });
        return;
      }
      if (v >= velocityThreshold) {
        const target = canClose && y > PEEK_Y ? CLOSED_Y : PEEK_Y;
        translateY.value = withSpring(target, { stiffness: springStiffness, damping: springDamping }, (finished) => {
          if (finished && target === CLOSED_Y) runOnJS(onChange)(false);
        });
        return;
      }

      // Avstandsbasert snap
      if (progress <= snapUpThreshold) {
        translateY.value = withSpring(FULL_OPEN_Y, { stiffness: springStiffness, damping: springDamping });
      } else if (!canClose || y <= PEEK_Y || progress <= (1 + snapDownThreshold)) {
        translateY.value = withSpring(PEEK_Y, { stiffness: springStiffness, damping: springDamping });
      } else {
        translateY.value = withTiming(CLOSED_Y, { duration: 180 }, (finished) => {
          if (finished) runOnJS(onChange)(false);
        });
      }
    });

  useAnimatedReaction(
    () => {
      const span = PEEK_Y - FULL_OPEN_Y || 1;
      return (translateY.value - FULL_OPEN_Y) / span;
    },
    (p) => {
      if (onProgress) {
        // clamp for sanity; you can send raw if you prefer
        const clamped = Math.max(0, Math.min(1.2, p));
        runOnJS(onProgress)(clamped);
      }
    },
    [FULL_OPEN_Y, PEEK_Y]
  );
  
  // Arkets stil
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Background dimming (0 at peek, ~0.35 when fully open)
  const backdropStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateY.value,
      [PEEK_Y, FULL_OPEN_Y],
      [0, 0.35],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  // Tap on the backdrop → return to peek (or close completely if canClose)
  const onBackdropPress = () => {
    if (canClose) {
      translateY.value = withTiming(CLOSED_Y, { duration: 180 }, (finished) => {
        if (finished) runOnJS(onChange)(false);
      });
    } else {
      translateY.value = withSpring(PEEK_Y, { stiffness: springStiffness, damping: springDamping });
    }
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Bakgrunn */}
      <Animated.View pointerEvents={open ? "auto" : "none"} style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onBackdropPress} />
      </Animated.View>

      {/* Selve arket */}
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.sheet, { height: SCREEN_H }, sheetStyle]}>
          <View style={styles.handle} />
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "black",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#111",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  handle: {
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#333",
    marginVertical: 10,
  },
});
