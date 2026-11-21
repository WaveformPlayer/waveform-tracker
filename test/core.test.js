import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import WaveformPlayer from '@arraypress/waveform-player/no-autoinit';
import tracker from '../src/index.js';

/**
 * The tracker against the real 2.0 core (the `file:../waveform-player`
 * devDependency), not fake players: discovery through getAllInstances() and
 * `waveformplayer:ready`, delivery from the core's own container events, and
 * release on destroy. External audio mode, so the clock is the test's —
 * jsdom has no media playback.
 */

const PEAKS = Array.from({ length: 64 }, (_, i) => (i % 8) / 8);
let now;

function makePlayer(url = '/audio/core.mp3') {
	const div = document.createElement('div');
	document.body.appendChild(div);
	return new WaveformPlayer(div, { url, title: 'Core', audioMode: 'external', waveform: PEAKS });
}

beforeEach(() => {
	now = 2_000_000;
	vi.spyOn(Date, 'now').mockImplementation(() => now);
	// jsdom has no 2D canvas; the core draws nothing without a context.
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
	tracker.reset();
	WaveformPlayer.destroyAll?.();
	vi.restoreAllMocks();
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('with the 2.0 core', () => {
	it('tracks players that exist before init() through getAllInstances()', () => {
		const player = makePlayer();
		tracker.init({ handler: () => {}, session: false });
		expect(tracker.getTrackedCount()).toBe(1);
		player.destroy();
	});

	it('tracks players created after init() through waveformplayer:ready', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		tracker.init({ handler: () => {}, session: false });
		const player = makePlayer();
		vi.advanceTimersByTime(150); // the core announces ready after 100ms
		expect(tracker.getTrackedCount()).toBe(1);
		player.destroy();
		expect(tracker.getTrackedCount()).toBe(0);
	});

	it('delivers play, listen and complete from the core events, with the ended detail', () => {
		const events = [];
		const player = makePlayer();
		tracker.init({ handler: (e) => events.push(e), events: { play: 1, listen: 5, complete: 90 }, session: false });

		player.setPlayingState(true);
		for (let t = 0; t <= 100; t++) {
			now += 1000;
			player.setProgress(t, 100); // t = 100 also synthesizes ended
		}

		expect(events.map((e) => e.event)).toEqual(['play', 'listen', 'complete']);
		expect(events[0]).toMatchObject({ url: '/audio/core.mp3', title: 'Core', duration: 100 });
		player.destroy();
	});
});
