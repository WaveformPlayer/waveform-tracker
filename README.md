<div align="center">

# WaveformTracker

**Lightweight, privacy-first analytics for WaveformPlayer.**
Track meaningful audio engagement — real listens, not bounces — and send it anywhere.

[![npm version](https://img.shields.io/npm/v/@arraypress/waveform-tracker?style=flat-square&labelColor=09090b&color=3f3f46)](https://www.npmjs.com/package/@arraypress/waveform-tracker)
[![license](https://img.shields.io/npm/l/@arraypress/waveform-tracker?style=flat-square&labelColor=09090b&color=3f3f46)](https://github.com/WaveformPlayer/waveform-tracker/blob/main/LICENSE)

**[Documentation](https://docs.waveformplayer.com/)** · [npm](https://www.npmjs.com/package/@arraypress/waveform-tracker)

</div>

---

## Install

```bash
npm install @arraypress/waveform-tracker @arraypress/waveform-player
```

```js
import WaveformTracker from '@arraypress/waveform-tracker';

WaveformTracker.init({
  endpoint: '/api/listens',
  events: { play: 3, listen: 30, complete: 90 }
});
```

Version 2 needs `@arraypress/waveform-player` 2.0 and a browser from 2023 or
later (Chrome/Edge 111, Firefox 114, Safari 16.4). TypeScript declarations are
included. The package is ES modules only; on Node 22.12+ `require()` loads it
too (`require('@arraypress/waveform-tracker').default`). For a `<script>` tag,
load `dist/waveform-tracker.min.js` after the player; it sets
`window.WaveformTracker`.

## Documentation

Full configuration, payload shape and privacy notes live in the docs.

### -> [docs.waveformplayer.com](https://docs.waveformplayer.com/)

[Configuration](https://docs.waveformplayer.com/extensions/tracker/configuration/) · [Payload](https://docs.waveformplayer.com/extensions/tracker/payload/) · [Privacy](https://docs.waveformplayer.com/extensions/tracker/privacy/)

## License

MIT © [ArrayPress](https://github.com/arraypress)
