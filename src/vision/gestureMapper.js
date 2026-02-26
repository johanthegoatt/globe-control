import { TRACKING_CONFIG } from "../config.js";
import { clamp } from "../utils/math.js";

export function mapGesturesToControls(frameData, prevState, config) {
  const now = frameData.timestamp;
  const hasTrack = frameData.hasHand && frameData.confidence >= TRACKING_CONFIG.minConfidence;

  const nextState = {
    ...prevState,
    lastSeenAt: hasTrack ? now : prevState.lastSeenAt,
    mode: prevState.mode || "idle",
    pinchActive: prevState.pinchActive || false,
    pinchHoldFrames: prevState.pinchHoldFrames || 0,
    pinchReleaseFrames: prevState.pinchReleaseFrames || 0,
    pinchCooldownUntil: prevState.pinchCooldownUntil || 0,
    orbitCandidateFrames: prevState.orbitCandidateFrames || 0,
    lastOrbitSignX: prevState.lastOrbitSignX || 0,
    lastOrbitSignY: prevState.lastOrbitSignY || 0,
    orbitConsistencyFrames: prevState.orbitConsistencyFrames || 0,
    lastPointer: prevState.lastPointer || null,
    lastPinchDistance: prevState.lastPinchDistance || null
  };

  let orbitDx = 0;
  let orbitDy = 0;
  let zoomDelta = 0;
  let orbitActive = false;
  let zoomActive = false;
  let pinchIntentConfirmed = false;
  let orbitSuppressedByPinch = false;
  let rejectionReason = frameData.rejectionReason || "none";
  let suppressionReason = "none";
  let mode = "idle";

  const lowQualityFreeze = frameData.controlFrozen || frameData.frameQuality < TRACKING_CONFIG.lowQualityFreeze;

  const pinchDistance = frameData.pinch.distanceNorm;
  const pinchCooldownActive = now < nextState.pinchCooldownUntil;
  const pinchCandidate = hasTrack && !pinchCooldownActive && pinchDistance < TRACKING_CONFIG.pinchOnThreshold;
  const pinchReleaseCandidate = !hasTrack || pinchDistance > TRACKING_CONFIG.pinchOffThreshold;

  if (pinchCandidate) {
    nextState.pinchHoldFrames += 1;
    nextState.pinchReleaseFrames = 0;
  } else if (pinchReleaseCandidate) {
    nextState.pinchReleaseFrames += 1;
    nextState.pinchHoldFrames = 0;
  }

  if (!nextState.pinchActive && nextState.pinchHoldFrames >= TRACKING_CONFIG.pinchActivationFrames) {
    nextState.pinchActive = true;
    nextState.lastPinchDistance = pinchDistance;
  }
  if (nextState.pinchActive && nextState.pinchReleaseFrames >= TRACKING_CONFIG.pinchReleaseFrames) {
    nextState.pinchActive = false;
    nextState.lastPinchDistance = null;
    nextState.pinchCooldownUntil = now + TRACKING_CONFIG.pinchReleaseCooldownMs;
  }

  pinchIntentConfirmed = nextState.pinchActive;

  if (hasTrack && frameData.pointerFiltered) {
    if (nextState.lastPointer) {
      const rawDx = frameData.pointerFiltered.x - nextState.lastPointer.x;
      const rawDy = frameData.pointerFiltered.y - nextState.lastPointer.y;
      const dx = Math.abs(rawDx) >= config.deadzone ? rawDx : 0;
      const dy = Math.abs(rawDy) >= config.deadzone ? rawDy : 0;

      orbitDx = clamp(dx * config.orbitSensitivity * 5.6, -0.04, 0.04);
      orbitDy = clamp(dy * config.orbitSensitivity * 5.6, -0.04, 0.04);
      const moving = orbitDx !== 0 || orbitDy !== 0;
      if (moving) {
        const sx = orbitDx === 0 ? 0 : orbitDx > 0 ? 1 : -1;
        const sy = orbitDy === 0 ? 0 : orbitDy > 0 ? 1 : -1;
        const consistentX = sx === 0 || sx === nextState.lastOrbitSignX || nextState.lastOrbitSignX === 0;
        const consistentY = sy === 0 || sy === nextState.lastOrbitSignY || nextState.lastOrbitSignY === 0;
        if (consistentX && consistentY) {
          nextState.orbitConsistencyFrames += 1;
        } else {
          nextState.orbitConsistencyFrames = 1;
        }
        nextState.orbitCandidateFrames += 1;
        nextState.lastOrbitSignX = sx || nextState.lastOrbitSignX;
        nextState.lastOrbitSignY = sy || nextState.lastOrbitSignY;
      } else {
        nextState.orbitCandidateFrames = 0;
        nextState.orbitConsistencyFrames = 0;
        nextState.lastOrbitSignX = 0;
        nextState.lastOrbitSignY = 0;
      }
      orbitActive =
        moving &&
        nextState.orbitCandidateFrames >= TRACKING_CONFIG.orbitActivationFrames &&
        nextState.orbitConsistencyFrames >= TRACKING_CONFIG.orbitActivationFrames;
    }
    nextState.lastPointer = frameData.pointerFiltered;
  } else {
    nextState.lastPointer = null;
    nextState.orbitCandidateFrames = 0;
    nextState.orbitConsistencyFrames = 0;
    nextState.lastOrbitSignX = 0;
    nextState.lastOrbitSignY = 0;
  }

  if (nextState.pinchActive) {
    if (nextState.lastPinchDistance == null) {
      nextState.lastPinchDistance = pinchDistance;
    } else {
      const delta = nextState.lastPinchDistance - pinchDistance;
      const zoomConfidence = clamp(frameData.pinchConfidence * 0.65 + frameData.frameQuality * 0.35, 0, 1);
      zoomDelta = clamp(delta * config.zoomSensitivity * 1.9 * zoomConfidence, -0.06, 0.06);
      zoomActive = Math.abs(zoomDelta) > TRACKING_CONFIG.zoomDeadband;
      nextState.lastPinchDistance = pinchDistance;
    }
  } else {
    nextState.lastPinchDistance = null;
  }

  if (nextState.pinchActive && !TRACKING_CONFIG.orbitWhilePinching) {
    orbitSuppressedByPinch = orbitActive;
    orbitActive = false;
    orbitDx = 0;
    orbitDy = 0;
    suppressionReason = "orbit_suppressed_by_pinch";
  }

  if (lowQualityFreeze) {
    orbitActive = false;
    zoomActive = false;
    orbitDx = 0;
    orbitDy = 0;
    zoomDelta = 0;
    suppressionReason = "low_quality_freeze";
  }

  if (!hasTrack) {
    rejectionReason = "low_confidence";
  } else if (pinchCooldownActive) {
    rejectionReason = "pinch_cooldown";
  } else if (!pinchIntentConfirmed && frameData.pinch.active) {
    rejectionReason = "pinch_not_confirmed";
  }

  if (zoomActive) mode = "zoom";
  else if (orbitActive) mode = "orbit";
  else mode = "idle";

  if (frameData.motionState === "pinch_candidate" && mode === "idle") {
    mode = "pinch_candidate";
  } else if (frameData.motionState === "orbit_candidate" && mode === "idle") {
    mode = "orbit_candidate";
  }

  nextState.mode = mode;

  const trackingLost = now - nextState.lastSeenAt > TRACKING_CONFIG.trackingLostMs;

  return {
    mode,
    orbitActive,
    orbitDx,
    orbitDy,
    zoomActive,
    zoomDelta,
    interactionConfidence: frameData.frameQuality,
    trackingLost,
    pinchIntentConfirmed,
    orbitSuppressedByPinch,
    suppressionReason,
    rejectionReason,
    nextState
  };
}
