# "Hiding in the noise" explainer

Source of the video on the `/noise` page (`public/media/hiding-in-the-noise.mp4`).

| File          | What it is                                                                  |
| ------------- | --------------------------------------------------------------------------- |
| `script.json` | Narration, scene by scene: `text` is shown in captions, `say` is spoken     |
| `narrate.py`  | Voice-over with a local Piper voice, scene and caption timings, WebVTT      |
| `scene.html`  | The animation: every frame drawn on a canvas as a function of time          |
| `scene.js`    | Scenes, synced to the narration timings in `src/noise/explainer.json`       |
| `render.mjs`  | Headless Chromium frames, encoded by ffmpeg (libx264), muxed with the voice |

Figures on screen come from `src/sim/linkFacts.ts` (pinned by `tests/sim.test.ts`) and the
natural noise is the dashboard's own model in `src/sim/signals.ts`.

## Re-render

Requirements: Python with `piper-tts`, a Piper voice (`en-us-lessac-medium.onnx` and its
`.json`), ffmpeg with libx264 and Playwright's Chromium.

```bash
cd dashboard
python explainer/narrate.py --voice /path/to/en-us-lessac-medium.onnx
node explainer/render.mjs --stills 4,40,104   # optional preview frames in explainer/build/
node explainer/render.mjs                     # writes public/media/hiding-in-the-noise.*
```

`render.mjs` reads `FFMPEG`, `CHROMIUM`, `PLAYWRIGHT` (module path), `WORKERS` and `FPS` from the
environment. Intermediate files go to `explainer/build/` (git-ignored).
