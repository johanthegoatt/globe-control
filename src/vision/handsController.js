import { TRACKING_CONFIG } from "../config.js";
import { normalizedDistance } from "../utils/math.js";

export function createHandsController({ videoElement, overlayCanvas, onFrame, onError }) {
  const ctx = overlayCanvas.getContext("2d");

  const hands = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.65,
    minTrackingConfidence: 0.6
  });

  let debugEnabled = false;
  let running = false;
  let processing = false;
  let rafId = null;
  let lastProcessedAt = 0;
  let lastSeenAt = performance.now();
  let lastLockedAt = 0;
  let filteredPointer = null;
  let lastFilteredAt = 0;
  let lastRawPointer = null;
  let outlierLatch = 0;
  let lastInferenceLatencyMs = 0;

  const minFrameIntervalMs = 1000 / Math.max(1, TRACKING_CONFIG.maxProcessFps);

  function clearOverlay() {
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }

  hands.onResults((results) => {
    clearOverlay();

    const now = performance.now();
    let payload = {
      hasHand: false,
      pointerRaw: null,
      pointerFiltered: null,
      pinch: { active: false, distanceNorm: 0 },
      pinchConfidence: 0,
      confidence: 0,
      frameQuality: 0,
      stabilityScore: 0,
      latencyMs: lastInferenceLatencyMs,
      controlFrozen: false,
      motionState: "idle",
      timestamp: now,
      landmarks: null,
      trackingState: now - lastSeenAt > TRACKING_CONFIG.trackingLostMs ? "lost" : "searching",
      rejectionReason: null
    };

    const landmarks = results.multiHandLandmarks?.[0];
    const handedness = results.multiHandedness?.[0];

    if (landmarks) {
      const confidence = handedness?.score ?? 0.8;
      const palmScale = Math.hypot(landmarks[0].x - landmarks[9].x, landmarks[0].y - landmarks[9].y);
      const pinchDistance = normalizedDistance(landmarks, 4, 8, palmScale);
      const pinchDistanceZ = Math.abs((landmarks[4].z ?? 0) - (landmarks[8].z ?? 0)) / Math.max(palmScale, 1e-5);
      const pointerRaw = { x: landmarks[8].x, y: landmarks[8].y };

      const jump = lastRawPointer
        ? Math.hypot(pointerRaw.x - lastRawPointer.x, pointerRaw.y - lastRawPointer.y)
        : 0;
      const outlier = jump > TRACKING_CONFIG.outlierJumpThreshold;
      outlierLatch = outlier ? Math.min(5, outlierLatch + 1) : Math.max(0, outlierLatch - 1);
      const outlierBlend = Math.min(0.92, outlierLatch * 0.18);
      const sourcePointer =
        outlier && filteredPointer
          ? {
              x: filteredPointer.x * outlierBlend + pointerRaw.x * (1 - outlierBlend),
              y: filteredPointer.y * outlierBlend + pointerRaw.y * (1 - outlierBlend)
            }
          : pointerRaw;

      const stabilityScore = Math.max(0, Math.min(1, 1 - jump * 7));
      const frameQuality = Math.max(0, Math.min(1, confidence * 0.6 + stabilityScore * 0.4));
      const adaptiveAlpha = TRACKING_CONFIG.pointerSmoothing * (0.7 + frameQuality * 0.9);
      const alpha = Math.max(0.12, Math.min(0.55, adaptiveAlpha));
      const nextFiltered = filteredPointer
        ? {
            x: filteredPointer.x + (sourcePointer.x - filteredPointer.x) * alpha,
            y: filteredPointer.y + (sourcePointer.y - filteredPointer.y) * alpha
          }
        : sourcePointer;

      const dtMs = Math.max(1, now - (lastFilteredAt || now));
      const movement = filteredPointer ? Math.hypot(nextFiltered.x - filteredPointer.x, nextFiltered.y - filteredPointer.y) : 0;
      const velocity = movement / dtMs;
      const tremorSuppressed = velocity < TRACKING_CONFIG.microTremorVelocityFloor;
      filteredPointer = tremorSuppressed && filteredPointer ? filteredPointer : nextFiltered;
      lastFilteredAt = now;

      lastRawPointer = pointerRaw;
      lastSeenAt = now;

      const pinchRange = Math.max(0.0001, TRACKING_CONFIG.pinchOffThreshold - TRACKING_CONFIG.pinchOnThreshold);
      const pinchDistanceCombined = pinchDistance * 0.8 + pinchDistanceZ * 0.2;
      const pinchConfidence = Math.max(
        0,
        Math.min(1, (TRACKING_CONFIG.pinchOffThreshold - pinchDistanceCombined) / pinchRange)
      );
      const controlFrozen = frameQuality < TRACKING_CONFIG.lowQualityFreeze;
      const trackingState =
        confidence >= TRACKING_CONFIG.minConfidence || now - lastLockedAt <= TRACKING_CONFIG.relockGraceMs
          ? "locked"
          : "searching";
      if (confidence >= TRACKING_CONFIG.minConfidence) {
        lastLockedAt = now;
      }

      let motionState = "idle";
      if (pinchDistanceCombined < TRACKING_CONFIG.pinchOnThreshold) {
        motionState = "pinch_candidate";
      } else if (!tremorSuppressed && velocity > TRACKING_CONFIG.microTremorVelocityFloor) {
        motionState = "orbit_candidate";
      }

      payload = {
        hasHand: true,
        pointerRaw,
        pointerFiltered: filteredPointer,
        pinch: {
          active: pinchDistanceCombined < TRACKING_CONFIG.pinchOnThreshold,
          distanceNorm: pinchDistanceCombined
        },
        pinchConfidence,
        confidence,
        frameQuality,
        stabilityScore,
        latencyMs: lastInferenceLatencyMs,
        controlFrozen,
        motionState,
        timestamp: now,
        landmarks,
        trackingState,
        rejectionReason: outlier ? "outlier_jump" : null
      };

      if (debugEnabled) {
        window.drawConnectors(ctx, landmarks, window.HAND_CONNECTIONS, { color: "#7dd3fc", lineWidth: 3 });
        window.drawLandmarks(ctx, landmarks, { color: "#ffffff", lineWidth: 1, radius: 2 });
      }
    }

    onFrame(payload);
  });

  async function processFrame() {
    if (!running) return;
    rafId = requestAnimationFrame(processFrame);

    const now = performance.now();
    if (
      processing ||
      now - lastProcessedAt < minFrameIntervalMs ||
      videoElement.readyState < 2 ||
      !videoElement.videoWidth ||
      !videoElement.videoHeight
    ) {
      return;
    }

    if (overlayCanvas.width !== videoElement.videoWidth || overlayCanvas.height !== videoElement.videoHeight) {
      overlayCanvas.width = videoElement.videoWidth;
      overlayCanvas.height = videoElement.videoHeight;
    }

    processing = true;
    lastProcessedAt = now;
    try {
      const startedAt = performance.now();
      await hands.send({ image: videoElement });
      lastInferenceLatencyMs = performance.now() - startedAt;
    } catch (error) {
      onError(error);
    } finally {
      processing = false;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      processFrame();
    },
    stop() {
      running = false;
      processing = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      clearOverlay();
    },
    setDebug(enabled) {
      debugEnabled = enabled;
      if (!enabled) clearOverlay();
    }
  };
}
