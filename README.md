# Globe Control

Hand-tracked 3D globe experience with gesture-based orbit/zoom and optional backend sync.

## Modules

- `index.html` + `src/` + `styles/`: browser runtime with MediaPipe + Three.js
- `backend/`: Express API for telemetry/session and optional trust-aware location flow

## Run Frontend

```powershell
npx --yes serve . -l 8080
```

Open: `http://127.0.0.1:8080/globe-control/index.html`

## Run Backend

```powershell
cd globe-control/backend
npm install
npm run migrate
npm run dev
```

