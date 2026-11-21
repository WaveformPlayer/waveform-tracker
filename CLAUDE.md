# CLAUDE.md — @arraypress/waveform-tracker

Analytics for WaveformPlayer: listens to the core's `waveformplayer:*` container
events (ready, play, pause, timeupdate, ended, destroy) and sends play / listen /
complete events to an endpoint (fetch, `sendBeacon` on unload). One source file:
`src/index.ts` (TypeScript, the singleton `window.WaveformTracker`).

## Commands (the gate before every commit)
- `npm run typecheck` — `tsc -p .`, includes `test/types/core-player.ts`, which
  checks the core's `WaveformPlayer` still fits the structural
  `WaveformTrackerPlayer` type. 0 errors.
- `npm test` — Vitest + jsdom; `test/core.test.js` drives real core players.
- `npm run lint` — Biome (policy in `biome.jsonc`).
- `npm run build` — esbuild IIFE + ESM + min into `dist/`, then `build:types`.

## Rules
- ES modules only (no CommonJS since 2.0); `main` is the ESM build, `unpkg`
  the minified script-tag build (the site loads `unpkg.com/@arraypress/waveform-tracker`
  bare — keep `unpkg` pointing at a build that runs from a `<script>`).
- No `src/` deep imports (`exports` has `.`, `./dist/*`, `./package.json`);
  `test/package.test.js` pins the packaging.
- The core's `waveformplayer:timeupdate` deliberately stays per-frame for this
  package — if the core ever throttles it, check the listen thresholds here.
- `waveformplayer:ready`/`destroy` are not `composed`: players inside shadow
  roots created after `init()` are missed (same since 1.x).
- devDependency on the core is the published range (`^2.x`); peer `^2.0.0`.
- Browser floor: Chrome/Edge 111, Firefox 114, Safari 16.4 (target ES2022); Node 22.12+.
- A change gets a test and a CHANGELOG entry. Family-wide releases: the
  `waveform-release` skill.
