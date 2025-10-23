// components/ui/ModalSheet.tsx
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

  /** Hvor mye av arket som er synlig i "peek"-tilstand (0.12 = 12% av skjermen) */
  peekRatio?: number;                 // default 0.12
  /** Hvor stor del av veien opp man må dra for å snappe helt åpen (0..1) */
  snapUpThreshold?: number;           // default 0.35
  /** Hvor stor del av veien ned man må dra for å snappe tilbake til peek (0..1) */
  snapDownThreshold?: number;         // default 0.35
  /** Fart (px/s) som “overstyrer” og tvinger snap opp/ned */
  velocityThreshold?: number;         // default 1000
  /** Fjærfølelse */
  springStiffness?: number;           // default 220
  springDamping?: number;             // default 22
  /** Tillat å lukke helt ved å dra forbi peek? */
  canClose?: boolean;                 // default false
  /** Valgfri topp-margin når helt åpen (for safe-area) */
  topInset?: number;                  // default 0
  /** progress callback (0 = fully open, 1 = at peek; >1 when moving towards closed) */
  onProgress?: (progress: number) => void;

  children?: React.ReactNode;
};

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

  // Y=0 er helt åpen (øverst). Y øker nedover.
  const FULL_OPEN_Y = topInset;                   // helt åpen pos
  const PEEK_Y = SCREEN_H * (1 - peekRatio);     // kollapset pos
  const CLOSED_Y = SCREEN_H;                      // helt skjult
  const translateY = useSharedValue(CLOSED_Y);

  // Åpne/lukke fra prop
  useEffect(() => {
    if (open) {
      translateY.value = withSpring(PEEK_Y, { stiffness: springStiffness, damping: springDamping });
    } else {
      translateY.value = withTiming(CLOSED_Y, { duration: 200 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, PEEK_Y, CLOSED_Y, springStiffness, springDamping]);

  // Drag-gest
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

  // Bakgrunns-dim (0 ved peek, ~0.35 ved full åpen)
  const backdropStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateY.value,
      [PEEK_Y, FULL_OPEN_Y],
      [0, 0.35],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  // Trykk på bakgrunn → tilbake til peek (eller lukk helt hvis canClose)
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
