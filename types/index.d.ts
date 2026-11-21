/**
 * WaveformTracker
 * Simple analytics tracking for WaveformPlayer
 *
 * @license MIT
 */
/** The events the tracker reports. */
export type WaveformTrackerEvent = 'play' | 'listen' | 'complete';
/**
 * A threshold in `events`: a number turns the event on (`0` included), a
 * missing key, `null` or `false` turns it off.
 */
export type WaveformTrackerThreshold = number | null | false;
/** Which events fire and when. */
export interface WaveformTrackerEvents {
    /** Seconds of accumulated media time. */
    play?: WaveformTrackerThreshold;
    /** Seconds of accumulated media time. */
    listen?: WaveformTrackerThreshold;
    /** Percent (0-100) of the duration reached, with real listening behind it. */
    complete?: WaveformTrackerThreshold;
}
/**
 * What the tracker delivers for each event, to `handler` or as the JSON body
 * POSTed to `endpoint`: `{ event, url, time, duration, page, ...metadata }`,
 * then `session`, then `title`.
 */
export interface WaveformTrackerPayload {
    event: WaveformTrackerEvent;
    /** The player's `options.url`. */
    url: string;
    /** Whole media-seconds heard (play/listen), or the position (complete). */
    time: number;
    /** Whole seconds; `0` when unknown (a live stream, or before metadata). */
    duration: number;
    /** `window.location.pathname`. */
    page: string;
    /** Present when `session` is on. */
    session?: string;
    /** Present when the player has a title. */
    title?: string;
    /** Each key from `metadata`. */
    [key: string]: unknown;
}
/** The options `init()` takes; supply `endpoint` or `handler`. */
export interface WaveformTrackerConfig {
    /** URL the events are POSTed to as JSON. */
    endpoint?: string | null;
    /** Delivers each payload instead of the network; `endpoint` is then never called. */
    handler?: ((payload: WaveformTrackerPayload) => void) | null;
    /** Defaults to `{ listen: 30 }`. */
    events?: WaveformTrackerEvents;
    /** Extra headers for the fetch POST (any header rules out sendBeacon). */
    headers?: Record<string, string>;
    /** Spread into every payload. */
    metadata?: Record<string, unknown>;
    /** An anonymous per-page session id on every payload (default `true`). */
    session?: boolean;
    /** Verbose console tracing; events are still delivered. */
    debug?: boolean;
}
/**
 * The player shape the tracker reads; a WaveformPlayer instance fits it.
 * Its events are dispatched on `container`; `audio` is absent or null in
 * external audio mode.
 */
export interface WaveformTrackerPlayer {
    container: HTMLElement;
    options: {
        url?: string | null;
        title?: string | null;
    };
    audio?: HTMLMediaElement | null;
}
/** One entry of `getStats()`, per tracked player. */
export interface WaveformTrackerStats {
    url: string;
    title: string | null;
    /** Accumulated media-seconds (a float). */
    elapsedTime: number;
    isTracking: boolean;
    /** The events already sent for the current track. */
    sentEvents: WaveformTrackerEvent[];
}
declare global {
    interface Window {
        /** The script-tag global: the tracker singleton. */
        WaveformTracker: WaveformTracker;
    }
}
declare class WaveformTracker {
    /**
     * Forward currentTime jumps (seconds) below this are always credited as
     * playback. A class-level constant, not a config option.
     */
    static SEEK_THRESHOLD: number;
    /** Seconds of headroom added to the wall-clock allowance for large jumps. */
    static SEEK_SLACK: number;
    /** Share of the audio up to the complete threshold that must have been heard. */
    static COMPLETE_ENGAGEMENT: number;
    constructor();
    /**
     * Initialize tracker with configuration. Calling it again reconfigures
     * the tracker (players already tracked keep their state) rather than
     * adding a second set of listeners.
     * @param config - Tracker configuration
     */
    init(config?: WaveformTrackerConfig): void;
    /**
     * Track all existing WaveformPlayer instances
     */
    trackAllPlayers(): void;
    /**
     * Track a specific player instance
     * @param player - Player instance to track
     */
    trackPlayer(player: WaveformTrackerPlayer): void;
    /**
     * Stop tracking a specific player
     * @param player - Player instance to stop tracking
     */
    untrackPlayer(player: WaveformTrackerPlayer): void;
    /**
     * Reset tracker - removes all tracking, including the document
     * listeners, so players created afterwards are ignored until init()
     */
    reset(): void;
    /**
     * Get tracking stats
     */
    getStats(): WaveformTrackerStats[];
    /**
     * Get number of tracked players
     */
    getTrackedCount(): number;
}
declare const tracker: WaveformTracker;
export default tracker;
export type { WaveformTracker };
//# sourceMappingURL=index.d.ts.map