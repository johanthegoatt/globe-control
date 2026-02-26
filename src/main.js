import { CONTROL_DEFAULTS, PERSISTENCE_KEYS, RUNTIME_CONFIG } from "./config.js";
import { listCameras, pickPreferredCamera, requestCameraBootstrap, startCamera, stopCamera } from "./camera/devices.js";
import { createGlobeScene } from "./three/globeScene.js";
import { createHandsController } from "./vision/handsController.js";
import { mapGesturesToControls } from "./vision/gestureMapper.js";
import { createControlPanel } from "./ui/panel.js";
import { createStatus } from "./ui/status.js";
import { createLogger } from "./utils/logger.js";
import { getOrCreateProfileId } from "./state/profileId.js";
import { syncProfileAndSettings, persistSettingsRemote, readLocalSettingsCache } from "./api/sync.js";
import { createTelemetryClient } from "./api/telemetry.js";
import { api } from "./api/client.js";

const logger = createLogger("GlobeControl");

const sceneRoot = document.getElementById("scene-root");
const videoElement = document.getElementById("input-video");
const overlayCanvas = document.getElementById("overlay-canvas");

const cameraSelect = document.getElementById("camera-select");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const resetBtn = document.getElementById("reset-btn");
const refreshBtn = document.getElementById("refresh-btn");
const pinLocationBtn = document.getElementById("pin-location-btn");
const focusPinBtn = document.getElementById("focus-pin-btn");
const orbitSlider = document.getElementById("orbit-sensitivity");
const zoomSlider = document.getElementById("zoom-sensitivity");
const smoothingSlider = document.getElementById("smoothing");
const qualityPresetSelect = document.getElementById("quality-preset");
const debugToggle = document.getElementById("debug-toggle");
const autoRotateToggle = document.getElementById("autorotate-toggle");
const statusPill = document.getElementById("status-pill");
const statusMessage = document.getElementById("status-message");
const fpsEl = document.getElementById("fps");
const syncStatusEl = document.getElementById("sync-status");
const qualityStatusEl = document.getElementById("quality-status");
const locationStatusEl = document.getElementById("location-status");
const handStatusEl = document.getElementById("hand-status");
const pinchStatusEl = document.getElementById("pinch-status");
const pinStatusEl = document.getElementById("pin-status");
const focusStatusEl = document.getElementById("focus-status");
const rejectionStatusEl = document.getElementById("rejection-status");
const verifyModalEl = document.getElementById("verify-modal");
const verifyModalMessageEl = document.getElementById("verify-modal-message");
const verifyRetryBtn = document.getElementById("verify-retry-btn");
const verifyApproxBtn = document.getElementById("verify-approx-btn");
const verifyCancelBtn = document.getElementById("verify-cancel-btn");

const uiState = {
  appPhase: "boot",
  syncState: "local",
  lastError: null
};

const sessionState = {
  running: false,
  stream: null,
  telemetryClient: null,
  metricErrors: 0,
  latestFps: 0
};

const trackingState = {
  latestFrame: null,
  latestIntent: null,
  replayRing: [],
  gestureState: {
    lastPointer: null,
    lastPinchDistance: null,
    pinchActive: false,
    lastSeenAt: performance.now()
  }
};

const profileState = {
  profileId: getOrCreateProfileId(),
  settings: {
    orbitSensitivity: CONTROL_DEFAULTS.orbitSensitivity,
    zoomSensitivity: CONTROL_DEFAULTS.zoomSensitivity,
    smoothing: CONTROL_DEFAULTS.smoothing,
    autoRotate: CONTROL_DEFAULTS.autoRotate,
    debugEnabled: false,
    qualityPreset: "balanced",
    updatedAt: new Date(0).toISOString(),
    schemaVersion: PERSISTENCE_KEYS.schemaVersion
  },
  selectedCameraId: "",
  cameras: []
};

const locationState = {
  state: "idle",
  pinStatus: "none",
  backendOnline: false,
  lastFocusResult: "no_pin",
  trustLevel: null,
  reasonCodes: [],
  lastGeo: null,
  pinHistory: [],
  verificationAttempts: 0,
  verifiedCount: 0,
  reviewCount: 0,
  blockedCount: 0
};

let scene;
let hands;
let frameHandle = null;
let lastFrameTime = performance.now();
let fpsFrames = 0;
let fpsTick = performance.now();
let metricsTick = performance.now();
let metricErrorSnapshot = 0;

const status = createStatus(statusPill, statusMessage);

function normalizeQualityPreset(value) {
  if (value === "precision" || value === "high") return "precision";
  if (value === "fast" || value === "low") return "fast";
  return "balanced";
}

function readLegacySettings() {
  try {
    const raw = localStorage.getItem(PERSISTENCE_KEYS.settings);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== PERSISTENCE_KEYS.schemaVersion) return null;
    return {
      orbitSensitivity: Number(parsed.orbitSensitivity) || CONTROL_DEFAULTS.orbitSensitivity,
      zoomSensitivity: Number(parsed.zoomSensitivity) || CONTROL_DEFAULTS.zoomSensitivity,
      smoothing: Number(parsed.smoothing) || CONTROL_DEFAULTS.smoothing,
      autoRotate: parsed.autoRotate ?? CONTROL_DEFAULTS.autoRotate,
      debugEnabled: Boolean(parsed.debugEnabled),
      qualityPreset: "balanced",
      updatedAt: new Date().toISOString(),
      schemaVersion: PERSISTENCE_KEYS.schemaVersion
    };
  } catch {
    return null;
  }
}

function applySettingsToUiAndScene() {
  orbitSlider.value = String(profileState.settings.orbitSensitivity);
  zoomSlider.value = String(profileState.settings.zoomSensitivity);
  smoothingSlider.value = String(profileState.settings.smoothing);
  profileState.settings.qualityPreset = normalizeQualityPreset(profileState.settings.qualityPreset);
  qualityPresetSelect.value = profileState.settings.qualityPreset;
  autoRotateToggle.checked = profileState.settings.autoRotate;
  debugToggle.checked = profileState.settings.debugEnabled;
  document.body.dataset.debug = profileState.settings.debugEnabled ? "1" : "0";

  if (scene) {
    scene.setSensitivity({
      orbit: profileState.settings.orbitSensitivity,
      zoom: profileState.settings.zoomSensitivity
    });
    scene.setSmoothing(profileState.settings.smoothing);
    scene.setAutoRotate(profileState.settings.autoRotate);
    scene.setDebugState(profileState.settings.debugEnabled);
  }

  if (hands) hands.setDebug(profileState.settings.debugEnabled);
}

function setSyncState(state) {
  uiState.syncState = state;
  syncStatusEl.dataset.sync = state;
  syncStatusEl.textContent = `Sync: ${state}`;
}

function setPhase(phase) {
  uiState.appPhase = phase;
}

function setLocationState(state, message, trustLevel = null, reasonCodes = []) {
  locationState.state = state;
  locationState.trustLevel = trustLevel;
  locationState.reasonCodes = reasonCodes;
  locationStatusEl.dataset.location = state;

  const trustText = trustLevel == null ? "" : ` (${trustLevel.toFixed(1)} trust)`;
  const reasonText = reasonCodes.length ? ` [${reasonCodes.join(", ")}]` : "";
  locationStatusEl.textContent = `Location: ${state}${trustText}`;
  rejectionStatusEl.textContent = `Reason: ${reasonCodes[0] || "--"}`;

  if (message) status.set(state === "verified" ? "running" : state === "error" ? "error" : "starting", `${message}${reasonText}`);
}

function setPinBadge(pinStatus) {
  locationState.pinStatus = pinStatus;
  pinStatusEl.dataset.pin = pinStatus;
  pinStatusEl.textContent = `Pin: ${pinStatus}`;
}

function setFocusResult(value) {
  locationState.lastFocusResult = value;
  focusStatusEl.dataset.focus = value;
  focusStatusEl.textContent = `Focus: ${value}`;
}

function persistLastPin(pin) {
  try {
    localStorage.setItem(PERSISTENCE_KEYS.lastPin, JSON.stringify(pin));
  } catch {
    // Ignore local storage write issues.
  }
}

function readLastPin() {
  try {
    const raw = localStorage.getItem(PERSISTENCE_KEYS.lastPin);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function validateFocusTransform(lat, lng) {
  if (!scene || !locationState.backendOnline) return null;
  try {
    const target = scene.getTargetRotation();
    const result = await api.validateFocusTransform({
      lat,
      lng,
      rotation: target
    });
    return result;
  } catch {
    return null;
  }
}

function setHandTelemetry(frameData, mapped) {
  handStatusEl.dataset.hand = frameData.trackingState;
  handStatusEl.textContent = `Hand: ${frameData.trackingState}`;

  const pinchState = mapped?.pinchIntentConfirmed ? "active" : "inactive";
  pinchStatusEl.dataset.pinch = pinchState;
  pinchStatusEl.textContent = `Pinch: ${pinchState}`;

  if (profileState.settings.debugEnabled) {
    const reason = mapped?.suppressionReason && mapped.suppressionReason !== "none"
      ? mapped.suppressionReason
      : mapped?.rejectionReason || "--";
    rejectionStatusEl.textContent = `Reason: ${reason}`;
  }
}

async function probeBackendHealth() {
  try {
    await api.getHealth();
    const runtime = await api.getRuntimeConfig();
    const policyMismatch = runtime?.policyVersion && runtime.policyVersion !== RUNTIME_CONFIG.policyVersion;
    const schemaMismatch =
      runtime?.schemaVersions?.settings != null &&
      Number(runtime.schemaVersions.settings) !== Number(RUNTIME_CONFIG.schemaVersions.settings);
    locationState.backendOnline = true;
    setSyncState(policyMismatch || schemaMismatch ? "backend-unreachable" : "backend-online");
    if (policyMismatch || schemaMismatch) {
      rejectionStatusEl.textContent = policyMismatch
        ? "Reason: runtime_policy_mismatch"
        : "Reason: runtime_schema_mismatch";
    }
  } catch {
    locationState.backendOnline = false;
    setSyncState("backend-unreachable");
  }
}

function showVerifyModal(show, message = "") {
  verifyModalEl.classList.toggle("hidden", !show);
  verifyModalEl.setAttribute("aria-hidden", show ? "false" : "true");
  if (message) verifyModalMessageEl.textContent = message;
}

function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported by browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      (error) => reject(error),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 12_000 }
    );
  });
}

function applyLocationPin({ lat, lng, trustLevel, status: pinStatus, reasonCodes = [] }) {
  if (!scene) return;
  scene.setLocationPin({ lat, lng, trustLevel, status: pinStatus });
  panel.setLocationPinAvailable(true);
  const pinRecord = { lat, lng, trustLevel, status: pinStatus, ts: new Date().toISOString() };
  persistLastPin(pinRecord);
  locationState.pinHistory.unshift(pinRecord);
  if (locationState.pinHistory.length > 5) {
    locationState.pinHistory.length = 5;
  }

  if (pinStatus === "verified") {
    setPinBadge("verified");
    setLocationState("verified", "Location pin applied. Pinned: verified.", trustLevel, reasonCodes);
    return;
  }
  if (pinStatus === "blocked") {
    setPinBadge("blocked");
    setLocationState("blocked", "Location pin applied. Pinned: blocked-untrusted.", trustLevel, reasonCodes);
    return;
  }
  setPinBadge("review");
  setLocationState("review", "Location pin applied. Pinned: review.", trustLevel, reasonCodes);
}

async function requestLocationPin(mode = "verify") {
  panel.setPinBusy(true);
  locationState.verificationAttempts += 1;
  setLocationState("requesting", "Requesting geolocation and verification...");

  try {
    const geo = await getBrowserLocation();
    locationState.lastGeo = geo;

    const endpoint = mode === "retry" ? api.retryLocationVerification : api.verifyLocation;
    const result = await endpoint({
      profileId: profileState.profileId,
      geo,
      clientTs: new Date().toISOString()
    });

    if (result.status === "verified" && result.pin) {
      locationState.verifiedCount += 1;
      applyLocationPin({
        lat: result.pin.lat,
        lng: result.pin.lng,
        trustLevel: result.trustLevel,
        status: "verified",
        reasonCodes: result.reasonCodes || []
      });
      const focused = scene.focusOnLocationPin();
      if (!focused.ok) {
        setFocusResult(focused.reason || "transform_mismatch");
        setLocationState("error", "Pin placed but focus failed.", result.trustLevel, result.reasonCodes || []);
      } else {
        setFocusResult("ok");
        const validated = await validateFocusTransform(result.pin.lat, result.pin.lng);
        if (validated?.mismatch) {
          setFocusResult("transform_mismatch");
          rejectionStatusEl.textContent = "Reason: focus_transform_mismatch";
        }
      }
      sessionState.telemetryClient?.recordEvent("pin_verified", "info", {
        trustLevel: result.trustLevel,
        focusResult: locationState.lastFocusResult
      });
      showVerifyModal(false);
      return;
    }

    if (result.status === "needs_review") {
      locationState.reviewCount += 1;
      applyLocationPin({
        lat: geo.lat,
        lng: geo.lng,
        trustLevel: result.trustLevel,
        status: "needs_review",
        reasonCodes: result.reasonCodes || []
      });
      const focused = scene.focusOnLocationPin();
      setFocusResult(focused.ok ? "ok" : focused.reason || "transform_mismatch");
      sessionState.telemetryClient?.recordEvent("pin_review", "warn", {
        trustLevel: result.trustLevel,
        reasons: result.reasonCodes || []
      });
      showVerifyModal(
        true,
        "Location needs review due to risk signals. Retry or use approximate untrusted pin."
      );
      return;
    }

    locationState.blockedCount += 1;
    applyLocationPin({
      lat: geo.lat,
      lng: geo.lng,
      trustLevel: result.trustLevel,
      status: "blocked",
      reasonCodes: result.reasonCodes || []
    });
    const focused = scene.focusOnLocationPin();
    setFocusResult(focused.ok ? "ok" : focused.reason || "transform_mismatch");
    sessionState.telemetryClient?.recordEvent("pin_blocked", "warn", {
      trustLevel: result.trustLevel,
      reasons: result.reasonCodes || []
    });
    showVerifyModal(true, "Network appears masked. Disable VPN/proxy then Retry verification.");
  } catch (error) {
    logger.warn("Location verify offline fallback", error);
    rejectionStatusEl.textContent = "Reason: backend_unreachable";
    if (locationState.lastGeo) {
      applyLocationPin({
        lat: locationState.lastGeo.lat,
        lng: locationState.lastGeo.lng,
        trustLevel: 20,
        status: "needs_review",
        reasonCodes: ["OFFLINE_FALLBACK"]
      });
      setFocusResult(scene.focusOnLocationPin().ok ? "ok" : "transform_mismatch");
      sessionState.telemetryClient?.recordEvent("pin_offline_fallback", "warn", {});
      showVerifyModal(false);
      return;
    }
    setLocationState("error", "Location verification failed. Allow location access and retry.");
  } finally {
    panel.setPinBusy(false);
  }
}

async function persistSettings() {
  profileState.settings.updatedAt = new Date().toISOString();
  profileState.settings.schemaVersion = PERSISTENCE_KEYS.schemaVersion;
  await persistSettingsRemote(profileState.profileId, profileState.settings, setSyncState);
}

function setRunningUI(running) {
  panel.setRunning(running);
}

function updateQualityBadge(frameData) {
  if (!frameData) {
    qualityStatusEl.textContent = "Quality: --";
    return;
  }
  qualityStatusEl.textContent = `Quality: ${frameData.frameQuality.toFixed(2)} (${frameData.trackingState})`;
}

function emitMetric(now, frameData) {
  if (!sessionState.running || !sessionState.telemetryClient || !frameData) return;
  if (now - metricsTick < 3500) return;
  const latestIntent = trackingState.latestIntent || { mode: "idle", rejectionReason: "none" };
  const normalizedMode = latestIntent.mode === "zoom" ? "zoom" : latestIntent.mode === "orbit" ? "orbit" : "idle";

  const errorDelta = Math.max(0, sessionState.metricErrors - metricErrorSnapshot);
  metricErrorSnapshot = sessionState.metricErrors;

  const pinEvents = {
    verified: locationState.pinStatus === "verified" ? 1 : 0,
    review: locationState.pinStatus === "review" ? 1 : 0,
    blocked: locationState.pinStatus === "blocked" ? 1 : 0
  };

  sessionState.telemetryClient.push({
    windowStart: new Date(metricsTick).toISOString(),
    windowEnd: new Date(now).toISOString(),
    avgFps: sessionState.latestFps,
    latencyMs: frameData.latencyMs || 0,
    trackingState: frameData.trackingState,
    qualityScore: frameData.frameQuality,
    modeDistribution: {
      idle: normalizedMode === "idle" ? 1 : 0,
      orbit: normalizedMode === "orbit" ? 1 : 0,
      zoom: normalizedMode === "zoom" ? 1 : 0
    },
    pinEvents,
    rejectionReasons: latestIntent.rejectionReason && latestIntent.rejectionReason !== "none"
      ? { [latestIntent.rejectionReason]: 1 }
      : {},
    pinchAttempts: frameData.motionState === "pinch_candidate" ? 1 : 0,
    pinchSuccesses: latestIntent.pinchIntentConfirmed ? 1 : 0,
    falseOrbitCount:
      frameData.motionState === "orbit_candidate" &&
      normalizedMode !== "orbit" &&
      !latestIntent.pinchIntentConfirmed
        ? 1
        : 0,
    errorCounters: {
      trackingErrors: errorDelta,
      lostFrames: frameData.trackingState === "lost" ? 1 : 0
    },
    payload: {
      replaySample: [...trackingState.replayRing]
    }
  });

  metricsTick = now;
}

function onTrackingFrame(frameData) {
  if (!scene) return;

  trackingState.latestFrame = frameData;
  updateQualityBadge(frameData);

  const mapped = mapGesturesToControls(frameData, trackingState.gestureState, {
    orbitSensitivity: profileState.settings.orbitSensitivity,
    zoomSensitivity: profileState.settings.zoomSensitivity,
    deadzone: CONTROL_DEFAULTS.deadzone
  });
  trackingState.latestIntent = mapped;
  trackingState.gestureState = mapped.nextState;
  setHandTelemetry(frameData, mapped);
  trackingState.replayRing.push({
    ts: frameData.timestamp,
    mode: mapped.mode,
    pointer: frameData.pointerFiltered ? { ...frameData.pointerFiltered } : null,
    pinch: frameData.pinch.distanceNorm,
    quality: frameData.frameQuality
  });
  if (trackingState.replayRing.length > 32) {
    trackingState.replayRing.shift();
  }

  const interacting = mapped.orbitActive || mapped.zoomActive;
  scene.setPrecisionState({ interacting, confidence: mapped.interactionConfidence });

  if (mapped.orbitActive) {
    scene.setOrbitDelta(-mapped.orbitDx, mapped.orbitDy);
  }

  if (mapped.zoomActive) {
    scene.setZoomTarget(scene.getZoom() + mapped.zoomDelta * scene.getZoomSensitivity());
  }

  if (sessionState.running) {
    if (frameData.trackingState === "lost" || mapped.trackingLost) {
      status.set("lost", "Tracking lost. Keep your hand in frame.");
    } else if (frameData.trackingState === "searching") {
      status.set("searching", "Searching hand... hold steady.");
    } else {
      const pinchHint = mapped.pinchIntentConfirmed ? "Pinch active." : "Move index finger to orbit and pinch to zoom.";
      status.set("running", `Tracking live. ${pinchHint}`);
    }
  }
}

const panel = createControlPanel({
  cameraSelect,
  startBtn,
  stopBtn,
  resetBtn,
  refreshBtn,
  pinLocationBtn,
  focusPinBtn,
  orbitSlider,
  zoomSlider,
  smoothingSlider,
  qualityPresetSelect,
  debugToggle,
  autoRotateToggle,
  fpsEl,
  onStart: async (deviceId) => start(deviceId),
  onStop: () => stop(),
  onReset: () => {
    if (scene) scene.resetView();
  },
  onRefreshCameras: async () => {
    if (sessionState.running) return;
    await refreshCameras();
    status.set("idle", "Camera list refreshed.");
  },
  onPinLocation: async () => {
    await requestLocationPin("verify");
  },
  onFocusPin: async () => {
    const focused = scene?.focusOnLocationPin();
    if (!focused?.ok) {
      setFocusResult(focused?.reason || "no_pin");
      setLocationState("error", "No pinned location to focus.");
      rejectionStatusEl.textContent = `Reason: ${focused?.reason || "no_pin"}`;
      return;
    }
    setFocusResult("ok");
    const latestPin = locationState.pinHistory[0];
    if (latestPin) {
      const validated = await validateFocusTransform(latestPin.lat, latestPin.lng);
      if (validated?.mismatch) {
        setFocusResult("transform_mismatch");
        rejectionStatusEl.textContent = "Reason: focus_transform_mismatch";
      }
    }
    status.set("running", "Focused on pinned location.");
  },
  onOrbitSensitivity: async (value) => {
    profileState.settings.orbitSensitivity = value;
    if (scene) scene.setSensitivity({ orbit: value });
    await persistSettings();
  },
  onZoomSensitivity: async (value) => {
    profileState.settings.zoomSensitivity = value;
    if (scene) scene.setSensitivity({ zoom: value });
    await persistSettings();
  },
  onSmoothing: async (value) => {
    profileState.settings.smoothing = value;
    if (scene) scene.setSmoothing(value);
    await persistSettings();
  },
  onQualityPreset: async (value) => {
    profileState.settings.qualityPreset = value;
    if (value === "precision") {
      profileState.settings.smoothing = 0.2;
      smoothingSlider.value = String(profileState.settings.smoothing);
      if (scene) scene.setSmoothing(profileState.settings.smoothing);
    } else if (value === "fast") {
      profileState.settings.smoothing = 0.1;
      smoothingSlider.value = String(profileState.settings.smoothing);
      if (scene) scene.setSmoothing(profileState.settings.smoothing);
    } else {
      profileState.settings.smoothing = 0.16;
      smoothingSlider.value = String(profileState.settings.smoothing);
      if (scene) scene.setSmoothing(profileState.settings.smoothing);
    }
    await persistSettings();
  },
  onDebugToggle: async (enabled) => {
    profileState.settings.debugEnabled = enabled;
    document.body.dataset.debug = enabled ? "1" : "0";
    if (hands) hands.setDebug(enabled);
    if (scene) scene.setDebugState(enabled);
    await persistSettings();
  },
  onAutoRotate: async (enabled) => {
    profileState.settings.autoRotate = enabled;
    if (scene) scene.setAutoRotate(enabled);
    await persistSettings();
  }
});

async function refreshCameras() {
  try {
    await requestCameraBootstrap();
  } catch (error) {
    logger.warn("Camera permission bootstrap failed", error);
  }

  const cameras = await listCameras();
  const preferred = pickPreferredCamera(cameras);
  profileState.cameras = cameras;

  const selectedFromSettings = profileState.selectedCameraId;
  const candidate = cameras.find((cam) => cam.deviceId === selectedFromSettings)?.deviceId;
  profileState.selectedCameraId = candidate || preferred?.deviceId || cameras[0]?.deviceId || "";

  panel.setCameraOptions(cameras, profileState.selectedCameraId);
}

async function start(deviceId) {
  if (sessionState.running) return;
  if (!profileState.cameras.length) {
    status.set("error", "No camera found. Connect a webcam and refresh.");
    return;
  }

  status.set("starting", "Starting camera and tracker...");

  try {
    const selected = deviceId || profileState.selectedCameraId || profileState.cameras[0].deviceId;
    const stream = await startCamera(videoElement, selected);

    sessionState.stream = stream;
    profileState.selectedCameraId = selected;
    sessionState.running = true;
    trackingState.gestureState = {
      mode: "idle",
      lastPointer: null,
      lastPinchDistance: null,
      pinchActive: false,
      lastSeenAt: performance.now()
    };
    trackingState.latestIntent = null;
    trackingState.replayRing = [];

    if (hands) hands.start();
    setRunningUI(true);

    sessionState.telemetryClient = createTelemetryClient({
      profileId: profileState.profileId,
      onSyncState: setSyncState
    });
    await sessionState.telemetryClient.start();
    sessionState.telemetryClient.recordEvent("session_started", "info", { cameraId: selected });

    setPhase("running");
    status.set("running", "Tracking live. Move index finger to orbit and pinch to zoom.");
  } catch (error) {
    logger.error("Failed to start camera", error);
    status.set("error", "Could not start camera. Check permissions or device availability.");
  }
}

async function stop() {
  if (!sessionState.running) return;

  if (hands) hands.stop();
  stopCamera(sessionState.stream);
  videoElement.srcObject = null;

  if (sessionState.telemetryClient) {
    sessionState.telemetryClient.recordEvent("session_stopped", "info", { reason: "user_stop" });
    await sessionState.telemetryClient.end("completed");
  }

  sessionState.stream = null;
  sessionState.running = false;
  sessionState.telemetryClient = null;

  trackingState.gestureState = {
    mode: "idle",
    lastPointer: null,
    lastPinchDistance: null,
    pinchActive: false,
    lastSeenAt: performance.now()
  };
  trackingState.latestIntent = null;
  trackingState.replayRing = [];

  if (scene) scene.setPrecisionState({ interacting: false, confidence: 0 });
  setRunningUI(false);
  setPhase("tracking-ready");
  status.set("idle", "Camera stopped. Press Start to resume.");
}

function animate(now) {
  frameHandle = requestAnimationFrame(animate);
  const delta = now - lastFrameTime;
  lastFrameTime = now;
  if (scene) scene.renderFrame(delta);

  fpsFrames += 1;
  const elapsed = now - fpsTick;
  if (elapsed >= 1000) {
    sessionState.latestFps = Math.round((fpsFrames * 1000) / elapsed);
    panel.setFps(sessionState.latestFps);
    fpsFrames = 0;
    fpsTick = now;
  }

  emitMetric(now, trackingState.latestFrame);
}

function bindWindowEvents() {
  window.addEventListener("resize", () => {
    if (scene) scene.resize();
  });
  window.addEventListener("beforeunload", () => {
    stop().catch(() => {});
    if (frameHandle) cancelAnimationFrame(frameHandle);
    if (scene) scene.dispose();
  });

  window.addEventListener("error", (event) => {
    sessionState.metricErrors += 1;
    logger.error("unhandled_error", event.error || event.message);
    sessionState.telemetryClient?.recordEvent("unhandled_error", "error", {
      message: String(event.message || event.error || "unknown")
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    sessionState.metricErrors += 1;
    logger.error("unhandled_rejection", event.reason);
    sessionState.telemetryClient?.recordEvent("unhandled_rejection", "error", {
      reason: String(event.reason || "unknown")
    });
  });

  verifyRetryBtn.addEventListener("click", async () => {
    showVerifyModal(false);
    await requestLocationPin("retry");
  });

  verifyApproxBtn.addEventListener("click", () => {
    if (!locationState.lastGeo) {
      showVerifyModal(false);
      setLocationState("error", "No recent geolocation available for approximate pin.");
      return;
    }
    applyLocationPin({
      lat: locationState.lastGeo.lat,
      lng: locationState.lastGeo.lng,
      trustLevel: 15,
      status: "needs_review",
      reasonCodes: ["UNTRUSTED_APPROXIMATE"]
    });
    const focused = scene?.focusOnLocationPin();
    setFocusResult(focused?.ok ? "ok" : focused?.reason || "transform_mismatch");
    showVerifyModal(false);
  });

  verifyCancelBtn.addEventListener("click", () => {
    showVerifyModal(false);
    setLocationState("idle", "Location pin canceled.");
    if (locationState.pinStatus === "none") {
      setFocusResult("no_pin");
    }
  });
}

async function init() {
  setPhase("boot");
  setSyncState("local");
  await probeBackendHealth();

  const localCache = readLocalSettingsCache();
  const legacy = readLegacySettings();
  if (localCache) profileState.settings = { ...profileState.settings, ...localCache };
  else if (legacy) profileState.settings = { ...profileState.settings, ...legacy };

  loadLegacySettingsIntoUi();

  scene = await createGlobeScene({
    mountEl: sceneRoot,
    onTextureWarning: (message) => status.set("running", message)
  });

  hands = createHandsController({
    videoElement,
    overlayCanvas,
    onFrame: onTrackingFrame,
    onError: (error) => {
      sessionState.metricErrors += 1;
      logger.error("Tracking error", error);
      status.set("error", "Tracking failed. Stop/start camera to recover.");
    }
  });

  applySettingsToUiAndScene();
  const cachedPin = readLastPin();
  if (cachedPin && Number.isFinite(cachedPin.lat) && Number.isFinite(cachedPin.lng)) {
    applyLocationPin({
      lat: cachedPin.lat,
      lng: cachedPin.lng,
      trustLevel: cachedPin.trustLevel ?? 15,
      status: cachedPin.status || "needs_review",
      reasonCodes: ["CACHED_PIN"]
    });
  }

  const synced = await syncProfileAndSettings({
    profileId: profileState.profileId,
    localSettings: profileState.settings,
    onSyncState: setSyncState
  });

  if (synced?.settings) {
    profileState.settings = { ...profileState.settings, ...synced.settings };
    applySettingsToUiAndScene();
  }

  setPhase("camera-ready");
  await refreshCameras();
  setPhase("tracking-ready");

  panel.setRunning(false);
  panel.setLocationPinAvailable(locationState.pinStatus !== "none");
  status.set("idle", "Allow camera access and press Start.");
  if (locationState.pinStatus === "none") {
    locationStatusEl.textContent = "Location: idle";
    setPinBadge("none");
  }
  setFocusResult(locationState.pinStatus === "none" ? "no_pin" : locationState.lastFocusResult || "ok");
  handStatusEl.dataset.hand = "searching";
  handStatusEl.textContent = "Hand: searching";
  pinchStatusEl.dataset.pinch = "inactive";
  pinchStatusEl.textContent = "Pinch: inactive";
  rejectionStatusEl.textContent = "Reason: --";

  bindWindowEvents();
  animate(performance.now());
}

function loadLegacySettingsIntoUi() {
  orbitSlider.value = String(profileState.settings.orbitSensitivity);
  zoomSlider.value = String(profileState.settings.zoomSensitivity);
  smoothingSlider.value = String(profileState.settings.smoothing);
  qualityPresetSelect.value = String(profileState.settings.qualityPreset || "balanced");
  autoRotateToggle.checked = profileState.settings.autoRotate;
  debugToggle.checked = profileState.settings.debugEnabled;
}

init().catch((error) => {
  uiState.lastError = String(error);
  logger.error("Initialization failed", error);
  status.set("error", "Initialization failed. Check console for details.");
});
