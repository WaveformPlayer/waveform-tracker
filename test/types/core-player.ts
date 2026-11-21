/**
 * Type-level check, run by `npm run typecheck` (tsc -p .), never executed:
 * the 2.0 core's WaveformPlayer, and the players its events carry, must fit
 * the tracker's structural WaveformTrackerPlayer. The core is the
 * `file:../waveform-player` devDependency, so this checks the real 2.0
 * declarations; a core change that breaks the fit fails the typecheck.
 */
import type {WaveformPlayer} from '@arraypress/waveform-player';
import tracker, {type WaveformTrackerPlayer} from '../../src/index.js';

declare const player: WaveformPlayer;

export const fits: WaveformTrackerPlayer = player;
tracker.trackPlayer(player);
tracker.untrackPlayer(player);

// The ready/destroy details (typed by the core on DocumentEventMap).
document.addEventListener('waveformplayer:ready', (e) => tracker.trackPlayer(e.detail.player));
document.addEventListener('waveformplayer:destroy', (e) => tracker.untrackPlayer(e.detail.player));

// The ended and timeupdate details carry the numbers the tracker reads.
document.addEventListener('waveformplayer:ended', (e) => {
    const {currentTime, duration}: {currentTime: number; duration: number} = e.detail;
    return currentTime + duration;
});
document.addEventListener('waveformplayer:timeupdate', (e) => {
    const {currentTime, duration}: {currentTime: number; duration: number} = e.detail;
    return currentTime + duration;
});
