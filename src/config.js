export const TEXTURE_URLS = {
  earthDay: "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg",
  earthNormal: "https://threejs.org/examples/textures/planets/earth_normal_2048.jpg",
  earthSpecular: "https://threejs.org/examples/textures/planets/earth_specular_2048.jpg",
  earthNight: "https://threejs.org/examples/textures/planets/earth_lights_2048.png",
  earthClouds: "https://threejs.org/examples/textures/planets/earth_clouds_1024.png",
  starfield: "https://threejs.org/examples/textures/galaxy_starfield.png"
};

export const RUNTIME_CONFIG = {
  apiBaseUrl: "http://127.0.0.1:6969/api/v1",
  frontendOrigin: "http://127.0.0.1:6767",
  policyVersion: "vivet-v5",
  schemaVersions: {
    settings: 2,
    calibration: 2,
    telemetry: 2,
    locationPolicy: 2
  }
};

export const CAMERA_CONFIG = {
  width: 960,
  height: 720,
  frameRateIdeal: 60,
  frameRateMax: 60
};

export const TRACKING_CONFIG = {
  maxProcessFps: 36,
  minConfidence: 0.42,
  trackingLostMs: 450,
  pinchOnThreshold: 0.62,
  pinchOffThreshold: 0.74,
  pointerSmoothing: 0.28,
  outlierJumpThreshold: 0.18,
  pinchActivationFrames: 4,
  pinchReleaseFrames: 3,
  pinchReleaseCooldownMs: 160,
  zoomDeadband: 0.0008,
  orbitWhilePinching: false,
  orbitActivationFrames: 3,
  lowQualityFreeze: 0.3,
  relockGraceMs: 380,
  microTremorVelocityFloor: 0.00075
};

export const PERSISTENCE_KEYS = {
  settings: "globe_v5.settings",
  lastPin: "globe_v5.last_pin",
  schemaVersion: 2
};

export const CONTROL_DEFAULTS = {
  orbitSensitivity: 1.2,
  zoomSensitivity: 1.4,
  smoothing: 0.16,
  zoomMin: 1.8,
  zoomMax: 6.2,
  initialZoom: 3.2,
  deadzone: 0.0025,
  autoRotate: true,
  autoRotateSpeed: 0.26
};

export const SCENE_CONFIG = {
  globeRadius: 1,
  atmosphereRadius: 1.055,
  debugAxisSize: 1.9
};
