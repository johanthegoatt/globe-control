import * as THREE from "three";
import { CONTROL_DEFAULTS, SCENE_CONFIG, TEXTURE_URLS } from "../config.js";
import { clamp, lerp } from "../utils/math.js";

function latLngToVector3(lat, lng, radius) {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const x = radius * Math.cos(latRad) * Math.sin(lngRad);
  const y = radius * Math.sin(latRad);
  const z = radius * Math.cos(latRad) * Math.cos(lngRad);
  return new THREE.Vector3(x, y, z);
}

export function computeGeoTransform(lat, lng, radius) {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  return {
    marker: latLngToVector3(lat, lng, radius),
    rotation: {
      x: clamp(-latRad, -Math.PI * 0.42, Math.PI * 0.42),
      y: Math.PI - lngRad
    }
  };
}

async function loadTextures(onTextureWarning) {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");

  const texturePack = {};

  try {
    texturePack.day = await loader.loadAsync(TEXTURE_URLS.earthDay);
  } catch {
    onTextureWarning?.("Earth day texture failed to load. Using fallback material.");
    texturePack.day = null;
  }

  try {
    texturePack.normal = await loader.loadAsync(TEXTURE_URLS.earthNormal);
  } catch {
    texturePack.normal = null;
  }

  try {
    texturePack.specular = await loader.loadAsync(TEXTURE_URLS.earthSpecular);
  } catch {
    texturePack.specular = null;
  }
  try {
    texturePack.night = await loader.loadAsync(TEXTURE_URLS.earthNight);
  } catch {
    texturePack.night = null;
  }
  try {
    texturePack.clouds = await loader.loadAsync(TEXTURE_URLS.earthClouds);
  } catch {
    texturePack.clouds = null;
  }

  try {
    texturePack.stars = await loader.loadAsync(TEXTURE_URLS.starfield);
  } catch {
    texturePack.stars = null;
  }

  return texturePack;
}

export async function createGlobeScene({ mountEl, onTextureWarning }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02070f);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = CONTROL_DEFAULTS.initialZoom;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  mountEl.appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0x7ba2ff, 0.65);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
  keyLight.position.set(5, 2, 5);
  scene.add(ambient, keyLight);

  const textures = await loadTextures(onTextureWarning);

  const globeGeo = new THREE.SphereGeometry(SCENE_CONFIG.globeRadius, 128, 128);
  const globeMat = textures.day
    ? new THREE.MeshPhongMaterial({
        map: textures.day,
        normalMap: textures.normal || null,
        specularMap: textures.specular || null,
        emissiveMap: textures.night || null,
        emissive: textures.night ? new THREE.Color(0x33406e) : new THREE.Color(0x000000),
        emissiveIntensity: textures.night ? 0.55 : 0,
        shininess: 16,
        specular: new THREE.Color(0x223347)
      })
    : new THREE.MeshPhongMaterial({ color: 0x2e5f8b, shininess: 10 });

  const globe = new THREE.Mesh(globeGeo, globeMat);
  scene.add(globe);

  const atmosphereGeo = new THREE.SphereGeometry(SCENE_CONFIG.atmosphereRadius, 96, 96);
  const atmosphereMat = new THREE.MeshPhongMaterial({
    color: 0x78c8ff,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false
  });
  const atmosphere = new THREE.Mesh(atmosphereGeo, atmosphereMat);
  scene.add(atmosphere);

  let cloudLayer = null;
  let locationMarker = null;
  let locationRing = null;
  if (textures.clouds) {
    const cloudGeo = new THREE.SphereGeometry(SCENE_CONFIG.globeRadius * 1.01, 96, 96);
    const cloudMat = new THREE.MeshPhongMaterial({
      map: textures.clouds,
      transparent: true,
      opacity: 0.32,
      depthWrite: false
    });
    cloudLayer = new THREE.Mesh(cloudGeo, cloudMat);
    scene.add(cloudLayer);
  }

  if (textures.stars) {
    const starsGeo = new THREE.SphereGeometry(90, 72, 72);
    const starsMat = new THREE.MeshBasicMaterial({ map: textures.stars, side: THREE.BackSide });
    scene.add(new THREE.Mesh(starsGeo, starsMat));
  }

  const debugAxis = new THREE.AxesHelper(SCENE_CONFIG.debugAxisSize);
  debugAxis.visible = false;
  scene.add(debugAxis);

  const state = {
    rotX: 0,
    rotY: 0,
    targetRotX: 0,
    targetRotY: 0,
    zoom: CONTROL_DEFAULTS.initialZoom,
    targetZoom: CONTROL_DEFAULTS.initialZoom,
    orbitSensitivity: CONTROL_DEFAULTS.orbitSensitivity,
    zoomSensitivity: CONTROL_DEFAULTS.zoomSensitivity,
    smoothing: CONTROL_DEFAULTS.smoothing,
    autoRotate: CONTROL_DEFAULTS.autoRotate,
    autoRotateSpeed: CONTROL_DEFAULTS.autoRotateSpeed,
    interactionActive: false,
    precisionConfidence: 1,
    locationPin: null
  };

  function setOrbitDelta(dx, dy) {
    const conf = clamp(state.precisionConfidence, 0.25, 1);
    state.targetRotY += dx * state.orbitSensitivity * conf;
    state.targetRotX += dy * state.orbitSensitivity * conf;
    state.targetRotX = clamp(state.targetRotX, -Math.PI * 0.42, Math.PI * 0.42);
  }

  function setZoomTarget(zoomValue) {
    const zoomSpan = CONTROL_DEFAULTS.zoomMax - CONTROL_DEFAULTS.zoomMin;
    const confSafeValue = clamp(
      zoomValue,
      CONTROL_DEFAULTS.zoomMin + zoomSpan * 0.01,
      CONTROL_DEFAULTS.zoomMax - zoomSpan * 0.01
    );
    state.targetZoom = confSafeValue;
  }

  function setSensitivity({ orbit, zoom }) {
    if (orbit != null) state.orbitSensitivity = orbit;
    if (zoom != null) state.zoomSensitivity = zoom;
  }

  function setSmoothing(alpha) {
    state.smoothing = clamp(alpha, 0.02, 0.35);
  }

  function setDebugState(enabled) {
    debugAxis.visible = enabled;
  }

  function setAutoRotate(enabled) {
    state.autoRotate = enabled;
  }

  function setInteractionActive(active) {
    state.interactionActive = active;
  }

  function setPrecisionState({ interacting, confidence }) {
    state.interactionActive = interacting;
    state.precisionConfidence = clamp(confidence ?? 1, 0, 1);
  }

  function resetView() {
    state.targetRotX = 0;
    state.targetRotY = 0;
    state.targetZoom = CONTROL_DEFAULTS.initialZoom;
  }

  function setLocationPin({ lat, lng, trustLevel = 50, status = "review" }) {
    state.locationPin = { lat, lng, trustLevel, status };

    const isReview = status === "review" || status === "needs_review";
    const markerColor = status === "verified" ? 0x64f2aa : isReview ? 0xf6c15a : 0xff7474;
    const transform = computeGeoTransform(lat, lng, SCENE_CONFIG.globeRadius * 1.015);
    const markerPos = transform.marker;

    if (!locationMarker) {
      const markerGeo = new THREE.SphereGeometry(0.022, 16, 16);
      const markerMat = new THREE.MeshBasicMaterial({ color: markerColor });
      locationMarker = new THREE.Mesh(markerGeo, markerMat);
      scene.add(locationMarker);
    }

    if (!locationRing) {
      const ringGeo = new THREE.RingGeometry(0.028, 0.04, 28);
      const ringMat = new THREE.MeshBasicMaterial({
        color: markerColor,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide
      });
      locationRing = new THREE.Mesh(ringGeo, ringMat);
      scene.add(locationRing);
    }

    locationMarker.position.copy(markerPos);
    locationRing.position.copy(markerPos);
    locationRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), markerPos.clone().normalize());

    locationMarker.material.color.setHex(markerColor);
    locationRing.material.color.setHex(markerColor);
  }

  function focusOnLocationPin() {
    if (!state.locationPin) return { ok: false, reason: "no_pin" };
    const transform = computeGeoTransform(state.locationPin.lat, state.locationPin.lng, SCENE_CONFIG.globeRadius);
    if (!Number.isFinite(transform.rotation.x) || !Number.isFinite(transform.rotation.y)) {
      return { ok: false, reason: "transform_mismatch" };
    }
    state.targetRotX = transform.rotation.x;
    state.targetRotY = transform.rotation.y;
    state.targetZoom = Math.max(CONTROL_DEFAULTS.zoomMin, CONTROL_DEFAULTS.initialZoom - 0.4);
    return { ok: true };
  }

  function clearLocationPin() {
    state.locationPin = null;
    if (locationMarker) {
      scene.remove(locationMarker);
      locationMarker.geometry.dispose();
      locationMarker.material.dispose();
      locationMarker = null;
    }
    if (locationRing) {
      scene.remove(locationRing);
      locationRing.geometry.dispose();
      locationRing.material.dispose();
      locationRing = null;
    }
  }

  function renderFrame(deltaMs = 16.67) {
    const dt = Math.max(1 / 240, Math.min(deltaMs / 1000, 1 / 20));
    const frameAlpha = 1 - Math.pow(1 - state.smoothing, dt * 60);

    state.rotX = lerp(state.rotX, state.targetRotX, frameAlpha);
    state.rotY = lerp(state.rotY, state.targetRotY, frameAlpha);
    state.zoom = lerp(state.zoom, state.targetZoom, frameAlpha);

    globe.rotation.x = state.rotX;
    globe.rotation.y = state.rotY;
    atmosphere.rotation.copy(globe.rotation);
    if (cloudLayer) {
      cloudLayer.rotation.x = state.rotX;
      cloudLayer.rotation.y = state.rotY;
      cloudLayer.rotation.y += dt * 0.025;
    }
    if (locationRing) {
      locationRing.lookAt(camera.position);
      locationRing.rotation.z += dt * 0.45;
    }

    camera.position.z = state.zoom;
    if (state.autoRotate && !state.interactionActive && state.precisionConfidence >= 0.55) {
      const autoDelta = state.autoRotateSpeed * dt;
      globe.rotation.y += autoDelta;
      atmosphere.rotation.y += autoDelta;
      if (cloudLayer) cloudLayer.rotation.y += autoDelta * 1.4;
      state.rotY += autoDelta;
      state.targetRotY += autoDelta;
    }

    renderer.render(scene, camera);
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function dispose() {
    renderer.dispose();
    globeGeo.dispose();
    globeMat.dispose();
    atmosphereGeo.dispose();
    atmosphereMat.dispose();
    if (cloudLayer) {
      cloudLayer.geometry.dispose();
      cloudLayer.material.dispose();
    }
    clearLocationPin();
    mountEl.innerHTML = "";
  }

  return {
    setOrbitDelta,
    setZoomTarget,
    setSensitivity,
    setSmoothing,
    setDebugState,
    setAutoRotate,
    setInteractionActive,
    setPrecisionState,
    setLocationPin,
    focusOnLocationPin,
    clearLocationPin,
    resetView,
    renderFrame,
    resize,
    dispose,
    getZoom: () => state.zoom,
    getZoomSensitivity: () => state.zoomSensitivity,
    getCurrentRotation: () => ({ x: state.rotX, y: state.rotY }),
    getTargetRotation: () => ({ x: state.targetRotX, y: state.targetRotY })
  };
}
