export function createControlPanel({
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
  onStart,
  onStop,
  onReset,
  onRefreshCameras,
  onPinLocation,
  onFocusPin,
  onOrbitSensitivity,
  onZoomSensitivity,
  onSmoothing,
  onQualityPreset,
  onDebugToggle,
  onAutoRotate
}) {
  startBtn.addEventListener("click", () => onStart(cameraSelect.value || undefined));
  stopBtn.addEventListener("click", () => onStop());
  resetBtn.addEventListener("click", () => onReset());
  refreshBtn.addEventListener("click", () => onRefreshCameras());
  pinLocationBtn.addEventListener("click", () => onPinLocation());
  focusPinBtn.addEventListener("click", () => onFocusPin());

  orbitSlider.addEventListener("input", () => onOrbitSensitivity(Number(orbitSlider.value)));
  zoomSlider.addEventListener("input", () => onZoomSensitivity(Number(zoomSlider.value)));
  smoothingSlider.addEventListener("input", () => onSmoothing(Number(smoothingSlider.value)));
  qualityPresetSelect.addEventListener("change", () => onQualityPreset(String(qualityPresetSelect.value)));
  debugToggle.addEventListener("change", () => onDebugToggle(debugToggle.checked));
  autoRotateToggle.addEventListener("change", () => onAutoRotate(autoRotateToggle.checked));

  return {
    setCameraOptions(cameras, selectedId) {
      cameraSelect.innerHTML = "";
      if (!cameras.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No camera found";
        cameraSelect.appendChild(option);
        return;
      }

      for (const cam of cameras) {
        const option = document.createElement("option");
        option.value = cam.deviceId;
        option.textContent = cam.label || `Camera ${cameraSelect.length + 1}`;
        cameraSelect.appendChild(option);
      }

      if (selectedId) cameraSelect.value = selectedId;
    },
    setRunning(running) {
      startBtn.disabled = running;
      stopBtn.disabled = !running;
      cameraSelect.disabled = running;
      refreshBtn.disabled = running;
    },
    setLocationPinAvailable(hasPin) {
      focusPinBtn.disabled = !hasPin;
    },
    setPinBusy(busy) {
      pinLocationBtn.disabled = busy;
      pinLocationBtn.textContent = busy ? "Verifying..." : "Pin My Location";
    },
    setFps(value) {
      fpsEl.textContent = `FPS: ${value}`;
    }
  };
}
