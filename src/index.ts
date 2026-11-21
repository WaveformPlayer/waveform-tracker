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
    options: {url?: string; title?: string};
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

/** `init()`'s config with every default filled in. */
interface ResolvedConfig {
    endpoint: string | null;
    handler: ((payload: WaveformTrackerPayload) => void) | null;
    events: WaveformTrackerEvents;
    headers: Record<string, string>;
    metadata: Record<string, unknown>;
    session: boolean;
    debug: boolean;
}

/** The `{ currentTime, duration }` detail of timeupdate and ended. */
interface TimeDetail {
    currentTime: number;
    duration: number;
}

/** Per-player tracking state. */
interface TrackerState {
    player: WaveformTrackerPlayer;
    url: string | undefined;
    lastTime: number | null;
    lastWall: number | null;
    elapsedTime: number;
    lastPosition: number | null;
    lastDuration: number | null;
    sentEvents: Set<WaveformTrackerEvent>;
    isTracking: boolean;
    lastCheck: number | null;
    handlers?: {
        play: () => void;
        pause: () => void;
        timeupdate: (e: CustomEvent<TimeDetail>) => void;
        ended: (e: CustomEvent<Partial<TimeDetail> | null>) => void;
    };
}

/** The `waveformplayer:ready` / `:destroy` detail. */
interface PlayerEventDetail {
    player: WaveformTrackerPlayer;
    url?: string;
}

/**
 * The page's WaveformPlayer class, once its script has loaded; read only by
 * trackAllPlayers(), behind a typeof check.
 */
declare const WaveformPlayer: {getAllInstances?: () => WaveformTrackerPlayer[]};

declare global {
    interface Window {
        /** The script-tag global: the tracker singleton. */
        WaveformTracker: WaveformTracker;
    }
}

class WaveformTracker {
    /**
     * Forward currentTime jumps (seconds) below this are always credited as
     * playback. A class-level constant, not a config option.
     */
    declare static SEEK_THRESHOLD: number;

    /** Seconds of headroom added to the wall-clock allowance for large jumps. */
    declare static SEEK_SLACK: number;

    /** Share of the audio up to the complete threshold that must have been heard. */
    declare static COMPLETE_ENGAGEMENT: number;

    // `declare` emits nothing: these are assigned in the constructor exactly
    // as before.
    /** @internal */ declare config: ResolvedConfig | null;
    /** @internal */ declare trackers: Map<WaveformTrackerPlayer, TrackerState>;
    /** @internal */ declare debug: boolean;
    /** @internal */ declare sessionId: string | null;
    /** @internal */ declare listeners: {
        ready: (e: CustomEvent<PlayerEventDetail>) => void;
        destroy: (e: CustomEvent<Partial<PlayerEventDetail> | null>) => void;
    } | null;

    constructor() {
        this.config = null;
        this.trackers = new Map();
        this.debug = false;
        this.sessionId = null;
        // document-level ready/destroy listeners, added once by init() and
        // removed by reset()
        this.listeners = null;
    }

    /**
     * Initialize tracker with configuration. Calling it again reconfigures
     * the tracker (players already tracked keep their state) rather than
     * adding a second set of listeners.
     * @param config - Tracker configuration
     */
    init(config: WaveformTrackerConfig = {}): void {
        // Default configuration
        this.config = {
            endpoint: config.endpoint || null,
            handler: config.handler || null,
            events: config.events || {listen: 30},
            headers: config.headers || {},
            metadata: config.metadata || {},
            session: config.session !== false,
            debug: config.debug || false
        };

        this.debug = this.config.debug;
        // A reconfigure is still the same page session, so keep its id
        this.sessionId = this.config.session
            ? (this.sessionId || this.generateSessionId())
            : null;

        // Validate config
        if (!this.config.endpoint && !this.config.handler) {
            this.warn('No endpoint or handler configured; events will not be delivered');
        }

        if (!this.listeners) {
            this.listeners = {
                // Listen for waveform players being ready
                ready: (e) => {
                    this.log('Player ready event caught:', e.detail.url);
                    this.trackPlayer(e.detail.player);
                },

                // Tear down trackers when a player is destroyed. Without this
                // the trackers Map keeps a strong reference to every player
                // (and its DOM) forever, leaking them in SPAs that
                // create/destroy players (v1.8.0+).
                destroy: (e) => {
                    this.log('Player destroy event caught:', e.detail?.url);
                    if (e.detail?.player) {
                        this.untrackPlayer(e.detail.player);
                    }
                }
            };

            // TRUE enables capturing phase
            document.addEventListener('waveformplayer:ready', this.listeners.ready as EventListener, true);
            document.addEventListener('waveformplayer:destroy', this.listeners.destroy as EventListener, true);
        }

        // Track any existing players that might already be initialized
        this.trackAllPlayers();

        this.log('Tracker initialized', this.config);
    }

    /**
     * Track all existing WaveformPlayer instances
     */
    trackAllPlayers(): void {
        if (typeof WaveformPlayer !== 'undefined' && WaveformPlayer.getAllInstances) {
            const players = WaveformPlayer.getAllInstances();
            players.forEach(player => this.trackPlayer(player));
        }
    }

    /**
     * Track a specific player instance
     * @param player - Player instance to track
     */
    trackPlayer(player: WaveformTrackerPlayer): void {
        // Nothing to report to before init() or after reset()
        if (!this.config) {
            this.warn('Call init() before tracking players');
            return;
        }

        // Validate player
        if (!player || !player.container || !player.options) {
            this.warn('Ignoring invalid player instance');
            return;
        }

        // Skip if already tracking
        if (this.trackers.has(player)) {
            return;
        }

        const tracker: TrackerState = {
            player: player,
            // The URL this state belongs to. load()/loadTrack() swap tracks on
            // the same player without firing `ended`, so syncTrack() compares
            // against it and resets the per-track state on a change.
            url: player.options.url,
            // Engagement is accumulated from media-time (currentTime) deltas
            // rather than wall-clock, so faster playback (1.5x/2x) is credited
            // for the content actually consumed. lastTime is the previous
            // currentTime seen while tracking; null resets the delta baseline.
            lastTime: null,
            // Date.now() when lastTime was recorded, so a forward jump can be
            // compared against the real time that passed (see accumulate()).
            lastWall: null,
            elapsedTime: 0,
            // Last known position/duration, for the unthrottled checks run on
            // pause and untrack (whose events carry no time).
            lastPosition: null,
            lastDuration: null,
            sentEvents: new Set(),
            isTracking: false,
            lastCheck: null
        };

        this.trackers.set(player, tracker);
        this.log('Tracking player:', player.options.url);

        // Listen to player events on the container element
        const container = player.container;

        // Store event handlers so we can remove them later
        tracker.handlers = {
            play: () => {
                this.syncTrack(tracker);
                tracker.isTracking = true;
                // Reset the media-time baseline; the next timeupdate just
                // records the position without crediting a delta.
                tracker.lastTime = null;
                this.log('Play started:', player.options.url);
            },

            pause: () => {
                if (tracker.isTracking) {
                    this.flush(tracker);
                    tracker.isTracking = false;
                    tracker.lastTime = null;
                    this.log('Paused. Total media time:', tracker.elapsedTime);
                }
            },

            timeupdate: (e) => {
                if (!tracker.isTracking || !this.config) return;
                this.syncTrack(tracker);

                const {currentTime, duration} = e.detail;

                // Accumulate engagement from media-time deltas (every event,
                // not throttled) so 1.5x/2x playback isn't under-credited.
                if (typeof currentTime === 'number') {
                    this.accumulate(tracker, currentTime);
                    tracker.lastPosition = currentTime;
                    tracker.lastDuration = duration;
                }

                // Throttle the event-firing checks to once per second
                const now = Date.now();
                if (tracker.lastCheck && now - tracker.lastCheck < 1000) return;
                tracker.lastCheck = now;

                this.checkEvents(tracker, currentTime, duration);
            },

            ended: (e) => {
                if (!this.config) return;
                this.syncTrack(tracker);

                // Read time from the event detail so this works in BOTH self and
                // external audio modes (in external mode player.audio is null).
                // v1.8.0+ dispatches ended with { currentTime, duration } and
                // also fires it in external mode.
                const detail = e.detail || {};
                const duration = typeof detail.duration === 'number' ? detail.duration : 0;
                const currentTime = typeof detail.currentTime === 'number'
                    ? detail.currentTime
                    : duration;

                // Credit the stretch since the last timeupdate: in a hidden
                // tab updates can stall long before the track ends.
                if (tracker.isTracking) {
                    this.accumulate(tracker, currentTime);
                }

                tracker.isTracking = false;
                tracker.lastTime = null;

                // Unthrottled: thresholds crossed since the last throttled
                // check would otherwise be wiped by the reset below. The
                // position is the end, so complete is checked here too.
                this.checkEvents(tracker, currentTime, duration);

                // Reset for replay
                tracker.sentEvents.clear();
                tracker.elapsedTime = 0;
                tracker.lastPosition = null;
                tracker.lastDuration = null;
                tracker.lastCheck = null;
            }
        };

        // Add event listeners
        container.addEventListener('waveformplayer:play', tracker.handlers.play);
        container.addEventListener('waveformplayer:pause', tracker.handlers.pause);
        container.addEventListener('waveformplayer:timeupdate', tracker.handlers.timeupdate as EventListener);
        container.addEventListener('waveformplayer:ended', tracker.handlers.ended as EventListener);
    }

    /**
     * Reset per-track state when the player has moved on to a different URL.
     *
     * Engagement and sent events are per track, but a player instance can
     * outlive many tracks. Without this, a track swapped in mid-play inherited
     * the previous track's elapsed time and never re-sent play/listen/complete.
     * @param tracker - Tracker state for a player
     * @internal
     */
    syncTrack(tracker: TrackerState): void {
        const url = tracker.player.options?.url;
        if (url === tracker.url) return;

        this.log('Track changed:', tracker.url, '->', url);
        tracker.url = url;
        tracker.sentEvents.clear();
        tracker.elapsedTime = 0;
        tracker.lastTime = null;
        tracker.lastPosition = null;
        tracker.lastDuration = null;
        tracker.lastCheck = null;
    }

    /**
     * Credit the media time played since the previous position.
     *
     * Non-advances (pauses/repeats) are ignored. Small forward deltas are
     * normal playback. A larger jump is only playback if it fits the wall-clock
     * time that passed: background tabs throttle the player's timeupdates, so
     * minutes of real listening can arrive as one jump. Anything clearly
     * beyond elapsed real time is a seek and isn't credited.
     * @param tracker - Tracker state for a player
     * @param currentTime - Playhead position (seconds)
     * @internal
     */
    accumulate(tracker: TrackerState, currentTime: number): void {
        const now = Date.now();
        if (tracker.lastTime !== null) {
            const delta = currentTime - tracker.lastTime;
            if (delta > 0 && (delta < WaveformTracker.SEEK_THRESHOLD
                || delta <= this.playableSince(tracker, now))) {
                tracker.elapsedTime += delta;
            }
        }
        tracker.lastTime = currentTime;
        tracker.lastWall = now;
    }

    /**
     * Most media time (seconds) that could have played since lastWall: the
     * wall time at the current rate, with 50% headroom for timer jitter plus
     * SEEK_SLACK. External mode has no audio element, so assumes 1x.
     * @param tracker - Tracker state for a player
     * @param now - Current Date.now()
     * @internal
     */
    playableSince(tracker: TrackerState, now: number): number {
        const wall = (now - tracker.lastWall!) / 1000;
        const rate = tracker.player.audio?.playbackRate ?? 1;
        return wall * rate * 1.5 + WaveformTracker.SEEK_SLACK;
    }

    /**
     * Fire any play/listen/complete events whose threshold has been reached.
     * @param tracker - Tracker state for a player
     * @param currentTime - Playhead position (seconds)
     * @param duration - Track duration (seconds)
     * @internal
     */
    checkEvents(tracker: TrackerState, currentTime: number, duration: number): void {
        if (!this.config) return;

        const totalElapsed = tracker.elapsedTime;
        const percentComplete = (currentTime / duration) * 100;
        const play = this.threshold(this.config.events.play);
        const listen = this.threshold(this.config.events.listen);
        const complete = this.threshold(this.config.events.complete);

        // Play event (time-based)
        if (play !== null && totalElapsed >= play && !tracker.sentEvents.has('play')) {
            this.sendEvent(tracker, 'play', Math.floor(totalElapsed), duration);
            tracker.sentEvents.add('play');
        }

        // Listen event (time-based)
        if (listen !== null && totalElapsed >= listen && !tracker.sentEvents.has('listen')) {
            this.sendEvent(tracker, 'listen', Math.floor(totalElapsed), duration);
            tracker.sentEvents.add('listen');
        }

        // Complete event (percent-based; needs a finite, known duration, so
        // never for live streams whose duration is Infinity). Position
        // alone would let a scrub to the end count, so the listener must also
        // have heard COMPLETE_ENGAGEMENT of the audio up to the threshold:
        // at complete: 90 on a 100s track, 45s of media time.
        if (complete !== null && Number.isFinite(duration) && duration > 0 && percentComplete >= complete
            && totalElapsed >= duration * (complete / 100) * WaveformTracker.COMPLETE_ENGAGEMENT
            && !tracker.sentEvents.has('complete')) {
            this.sendEvent(tracker, 'complete', Math.floor(currentTime), duration);
            tracker.sentEvents.add('complete');
        }
    }

    /**
     * Normalise an events threshold. A missing key, null or false disables
     * the event; 0 is a real threshold (fire on the first check after play).
     * Numeric strings are accepted, as the old truthy check did.
     * @param value - Configured threshold
     * @returns The threshold, or null when disabled
     * @internal
     */
    threshold(value: unknown): number | null {
        if (value == null || value === false || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    /**
     * Run the event checks unthrottled at the last known position, so
     * thresholds crossed inside the 1s throttle window aren't lost when
     * playback stops (pause) or tracking ends (untrack/destroy).
     * @param tracker - Tracker state for a player
     * @internal
     */
    flush(tracker: TrackerState): void {
        if (!tracker.isTracking) return;
        // A track swapped in since the last timeupdate owns nothing yet.
        this.syncTrack(tracker);
        if (tracker.lastDuration === null) return;
        this.checkEvents(tracker, tracker.lastPosition!, tracker.lastDuration);
    }

    /**
     * Stop tracking a specific player
     * @param player - Player instance to stop tracking
     */
    untrackPlayer(player: WaveformTrackerPlayer): void {
        const tracker = this.trackers.get(player);
        if (!tracker) return;

        // Deliver anything pending before the state is dropped
        this.flush(tracker);

        // Remove event listeners
        const container = player.container;
        if (container && tracker.handlers) {
            container.removeEventListener('waveformplayer:play', tracker.handlers.play);
            container.removeEventListener('waveformplayer:pause', tracker.handlers.pause);
            container.removeEventListener('waveformplayer:timeupdate', tracker.handlers.timeupdate as EventListener);
            container.removeEventListener('waveformplayer:ended', tracker.handlers.ended as EventListener);
        }

        // Remove from trackers
        this.trackers.delete(player);
        this.log('Stopped tracking player:', player.options?.url);
    }

    /**
     * Send tracking event
     * @internal
     */
    sendEvent(tracker: TrackerState, eventType: WaveformTrackerEvent, time: number, duration: number): void {
        // Validate required fields
        if (!tracker.player?.options?.url) {
            this.warn('Missing URL for event; skipping');
            return;
        }

        if (typeof time !== 'number' || typeof duration !== 'number') {
            this.warn('Invalid time or duration for event; skipping');
            return;
        }

        const payload: WaveformTrackerPayload = {
            event: eventType,
            url: tracker.player.options.url,
            time: time,
            // Live streams report Infinity (NaN before metadata), which JSON
            // serialises as null; send 0 for "unknown" so it stays a number.
            duration: Number.isFinite(duration) ? Math.floor(duration) : 0,
            page: window.location.pathname,
            ...this.config!.metadata
        };

        if (this.sessionId) {
            payload.session = this.sessionId;
        }

        // Add title if available
        if (tracker.player.options.title) {
            payload.title = tracker.player.options.title;
        }

        this.log('Sending event:', payload);

        // Use custom handler if provided
        if (this.config!.handler) {
            try {
                this.config!.handler(payload);
            } catch (error) {
                this.error('Custom handler threw:', error);
            }
            return;
        }

        // Otherwise POST to endpoint. 'complete' and 'listen' are terminal /
        // near-unload events, so deliver them in a way that survives unload.
        if (this.config!.endpoint) {
            const terminal = eventType === 'complete' || eventType === 'listen';
            this.send(this.config!.endpoint, payload, terminal);
        }
    }

    /**
     * Deliver a payload to the configured endpoint.
     *
     * Terminal events (complete, listen) often fire as the page is navigating
     * away, where a normal fetch would be cancelled, so they are sent with
     * fetch keepalive, which survives unload. The body is always JSON with
     * Content-Type: application/json; the endpoint and payload shape are
     * unchanged.
     *
     * sendBeacon is used only for a same-origin endpoint (or when fetch is
     * missing). Cross-origin, a beacon's JSON content type isn't
     * CORS-safelisted and beacons always send credentials, so an endpoint
     * answering Access-Control-Allow-Origin: * never receives the event —
     * yet sendBeacon still returns true, leaving no chance to fall back.
     * fetch uses credentials only same-origin, so a wildcard endpoint that
     * answers the preflight for Content-Type works.
     *
     * @param endpoint - Destination URL
     * @param payload - Event payload
     * @param terminal - Whether this is a terminal/near-unload event
     * @internal
     */
    send(endpoint: string, payload: WaveformTrackerPayload, terminal: boolean = false): void {
        const body = JSON.stringify(payload);
        const hasFetch = typeof fetch === 'function';

        if (terminal && this.canBeacon(endpoint, hasFetch)) {
            try {
                const blob = new Blob([body], {type: 'application/json'});
                if (navigator.sendBeacon(endpoint, blob)) {
                    return;
                }
                this.log('sendBeacon refused payload, falling back to fetch');
            } catch (error) {
                this.log('sendBeacon failed, falling back to fetch:', error);
            }
        }

        if (!hasFetch) {
            this.error('fetch is unavailable; event not delivered');
            return;
        }

        fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.config!.headers
            },
            body: body,
            keepalive: terminal
        }).catch(error => {
            this.error('Failed to send event:', error);
        });
    }

    /**
     * Whether a terminal event may go by sendBeacon: the API exists, no
     * custom headers are configured (a beacon can't set them), and the
     * endpoint is same-origin or fetch is unavailable (see send()).
     * @param endpoint - Destination URL
     * @param hasFetch - Whether fetch is available
     * @internal
     */
    canBeacon(endpoint: string, hasFetch: boolean): boolean {
        const hasCustomHeaders = this.config!.headers
            && Object.keys(this.config!.headers).length > 0;
        if (hasCustomHeaders
            || typeof navigator === 'undefined'
            || typeof navigator.sendBeacon !== 'function') {
            return false;
        }
        return !hasFetch || this.isSameOrigin(endpoint);
    }

    /**
     * Whether an endpoint (absolute or relative) is on the page's origin.
     * @param endpoint - Destination URL
     * @internal
     */
    isSameOrigin(endpoint: string): boolean {
        try {
            return new URL(endpoint, window.location.href).origin === window.location.origin;
        } catch (error) {
            return false;
        }
    }

    /**
     * Generate session ID
     * @internal
     */
    generateSessionId(): string {
        return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }

    /**
     * Debug logging - only emitted when debug mode is enabled.
     * @internal
     */
    log(...args: unknown[]): void {
        if (this.debug) {
            console.log('[WaveformTracker]', ...args);
        }
    }

    /**
     * Recoverable / configuration warning - always emitted so integration
     * mistakes surface even when debug mode is off.
     * @internal
     */
    warn(...args: unknown[]): void {
        console.warn('[WaveformTracker]', ...args);
    }

    /**
     * Genuine failure - always emitted so dropped events and thrown handlers
     * surface even when debug mode is off.
     * @internal
     */
    error(...args: unknown[]): void {
        console.error('[WaveformTracker]', ...args);
    }

    /**
     * Reset tracker - removes all tracking, including the document
     * listeners, so players created afterwards are ignored until init()
     */
    reset(): void {
        // Untrack all players
        this.trackers.forEach((tracker, player) => {
            this.untrackPlayer(player);
        });

        if (this.listeners) {
            document.removeEventListener('waveformplayer:ready', this.listeners.ready as EventListener, true);
            document.removeEventListener('waveformplayer:destroy', this.listeners.destroy as EventListener, true);
            this.listeners = null;
        }

        this.trackers.clear();
        this.config = null;
        this.sessionId = null;
    }

    /**
     * Get tracking stats
     */
    getStats(): WaveformTrackerStats[] {
        const stats: WaveformTrackerStats[] = [];
        this.trackers.forEach((tracker, player) => {
            stats.push({
                url: player.options?.url || 'unknown',
                title: player.options?.title || null,
                elapsedTime: tracker.elapsedTime,
                isTracking: tracker.isTracking,
                sentEvents: Array.from(tracker.sentEvents)
            });
        });
        return stats;
    }

    /**
     * Get number of tracked players
     */
    getTrackedCount(): number {
        return this.trackers.size;
    }
}

// Forward currentTime jumps (seconds) below this are always credited as normal
// playback. Larger jumps are credited only when they fit the wall-clock time
// that passed (a throttled background tab); otherwise they are seeks.
WaveformTracker.SEEK_THRESHOLD = 5;

// Seconds of headroom added to the wall-clock allowance for large jumps.
WaveformTracker.SEEK_SLACK = 1;

// Share of the audio up to the complete threshold that must have been heard
// (media time) before complete fires, so seeking to the end doesn't count.
WaveformTracker.COMPLETE_ENGAGEMENT = 0.5;

// Create singleton instance
const tracker = new WaveformTracker();

// Export for browser
if (typeof window !== 'undefined') {
    window.WaveformTracker = tracker;
}

// ES6 export
export default tracker;

// The singleton's class, as a type only: 1.x never exported the class
// itself, and still does not.
export type {WaveformTracker};