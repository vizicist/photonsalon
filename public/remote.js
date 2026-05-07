import { connect, StringCodec } from '../node_modules/nats.ws/esm/nats.js';

(function () {
    const params = new URLSearchParams(window.location.search);
    const targetHostEl = document.getElementById('target-host');
    const transportStateEl = document.getElementById('transport-state');
    const controller = document.getElementById('palette-controller');
    const activePointers = new Map();
    const sc = StringCodec();
    const defaultPressure = 0.25;
    const maxPressure = 1.0;
    const lingerDelayMs = 180;
    const pressureRisePerSecond = 0.55;
    const lingerMoveTolerance = 0.018;
    const natsUrl = params.get('nats') || window.NATS_URL || '';
    let targetHost = params.get('host') || window.PHOTON_SALON_HOST || 'photonsalon';
    let nc = null;
    let nextGid = Math.floor(Date.now() % 1000000);
    let lastSentAt = 0;

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        if (params.get('labels') === '1' || params.get('padlabels') === '1') {
            document.body.classList.add('show-pad-labels');
        }

        targetHostEl.textContent = targetHost;
        await connectNats();
        document.querySelectorAll('.pad').forEach(bindSurface);
    }

    async function connectNats() {
        if (!natsUrl) {
            setTransportState('error', 'NATS_URL missing');
            return;
        }
        setTransportState('connecting', 'NATS connecting');
        try {
            nc = await connect({
                servers: natsUrl,
                maxReconnectAttempts: -1,
                reconnect: true,
                reconnectTimeWait: 1000
            });
            setTransportState('ready', 'NATS ready');
            watchNatsStatus();
            await refreshTargetStatus();
        } catch (err) {
            nc = null;
            setTransportState('error', err.message || 'NATS connection failed');
        }
    }

    async function watchNatsStatus() {
        try {
            for await (const status of nc.status()) {
                if (status.type === 'disconnect') {
                    setTransportState('error', 'NATS disconnected');
                } else if (status.type === 'reconnect') {
                    setTransportState('ready', 'NATS ready');
                }
            }
        } catch (err) {
            setTransportState('error', err.message || 'NATS status error');
        }
    }

    async function refreshTargetStatus() {
        try {
            const status = await requestPaletteApi({ api: 'global.status' }, 1500);
            if (status && status.hostname) {
                targetHost = status.hostname;
                targetHostEl.textContent = targetHost;
            }
        } catch (err) {
            setTransportState('error', err.message || 'Palette status unavailable');
        }
    }

    function bindSurface(el) {
        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerup', onPointerUp);
        el.addEventListener('pointercancel', onPointerUp);
        el.addEventListener('lostpointercapture', onPointerUp);
    }

    function onPointerDown(event) {
        event.preventDefault();
        const source = event.currentTarget.dataset.source;
        if (!source) return;
        const gid = nextGid++;
        const coordinateEl = coordinateElementForEvent(event, source);
        const pos = normalizedElementPosition(event, coordinateEl);
        activePointers.set(event.pointerId, {
            gid,
            source,
            el: event.currentTarget,
            coordinateEl,
            pressure: defaultPressure,
            lastPos: pos,
            lingerStartedAt: performance.now(),
            pressureTimer: null
        });
        const active = activePointers.get(event.pointerId);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.classList.add('active');
        startPressureTimer(event.pointerId);
        sendPointerEvent('down', event, active, true);
    }

    function onPointerMove(event) {
        const active = activePointers.get(event.pointerId);
        if (!active) return;
        event.preventDefault();
        const now = performance.now();
        updatePressureFromMove(event, active, now);
        if (now - lastSentAt < 24) return;
        lastSentAt = now;
        sendPointerEvent('drag', event, active, false);
    }

    function onPointerUp(event) {
        const active = activePointers.get(event.pointerId);
        if (!active) return;
        event.preventDefault();
        activePointers.delete(event.pointerId);
        stopPressureTimer(active);
        active.el.classList.remove('active');
        sendPointerEvent('up', event, active, true);
    }

    function coordinateElementForEvent(event, source) {
        return event.currentTarget.dataset.source ? event.currentTarget : controller;
    }

    function normalizedElementPosition(event, el) {
        const rect = el.getBoundingClientRect();
        return {
            x: clamp((event.clientX - rect.left) / rect.width),
            y: 1 - clamp((event.clientY - rect.top) / rect.height)
        };
    }

    function updatePressureFromMove(event, active, now) {
        const pos = normalizedElementPosition(event, active.coordinateEl);
        if (distance(pos, active.lastPos) > lingerMoveTolerance) {
            active.lastPos = pos;
            active.lingerStartedAt = now;
        } else if (now - active.lingerStartedAt > lingerDelayMs) {
            const elapsed = (now - active.lingerStartedAt - lingerDelayMs) / 1000;
            active.pressure = clampToRange(defaultPressure + elapsed * pressureRisePerSecond, defaultPressure, maxPressure);
        }
    }

    function startPressureTimer(pointerId) {
        const active = activePointers.get(pointerId);
        if (!active) return;
        active.pressureTimer = setInterval(() => {
            const latest = activePointers.get(pointerId);
            if (!latest) return;
            const now = performance.now();
            if (now - latest.lingerStartedAt <= lingerDelayMs) return;
            const elapsed = (now - latest.lingerStartedAt - lingerDelayMs) / 1000;
            latest.pressure = clampToRange(defaultPressure + elapsed * pressureRisePerSecond, defaultPressure, maxPressure);
            sendPressureDrag(latest);
        }, 80);
    }

    function stopPressureTimer(active) {
        if (active.pressureTimer) {
            clearInterval(active.pressureTimer);
            active.pressureTimer = null;
        }
    }

    function sendPressureDrag(active) {
        const pos = active.lastPos;
        const payload = {
            host: targetHost,
            api: 'cursor.event',
            ddu: 'drag',
            source: active.source,
            gid: String(active.gid),
            x: pos.x.toFixed(5),
            y: pos.y.toFixed(5),
            z: active.pressure.toFixed(5),
            area: '0.00100'
        };
        postPaletteApi(payload);
    }

    async function sendPointerEvent(ddu, event, active, immediate) {
        const pos = normalizedElementPosition(event, active.coordinateEl);
        if (ddu !== 'up') active.lastPos = pos;
        const payload = {
            host: targetHost,
            api: 'cursor.event',
            ddu,
            source: active.source,
            gid: String(active.gid),
            x: pos.x.toFixed(5),
            y: pos.y.toFixed(5),
            z: (ddu === 'up' ? 0 : active.pressure).toFixed(5),
            area: pointerArea(event).toFixed(5)
        };

        if (immediate) {
            await postPaletteApi(payload);
        } else {
            postPaletteApi(payload);
        }
    }

    async function postPaletteApi(payload) {
        try {
            await requestPaletteApi(payload, 1000);
            setTransportState('ready', 'NATS ready');
        } catch (err) {
            setTransportState('error', err.message || 'NATS API error');
        }
    }

    async function requestPaletteApi(payload, timeout) {
        if (!nc) {
            throw new Error('NATS not connected');
        }

        const apiPayload = Object.assign({}, payload);
        const host = apiPayload.host || targetHost;
        delete apiPayload.host;

        const subject = `to_palette.${host}.api`;
        const msg = await nc.request(subject, sc.encode(JSON.stringify(apiPayload)), { timeout });
        const data = JSON.parse(sc.decode(msg.data));
        if (data.error) throw new Error(data.error);

        let result = data.result;
        if (typeof result === 'string' && (result.startsWith('{') || result.startsWith('['))) {
            try {
                result = JSON.parse(result);
            } catch (err) {
                // Return the original string if it only looks like JSON.
            }
        }
        return result;
    }

    function pointerArea(event) {
        const w = event.width || 1;
        const h = event.height || 1;
        return Math.max(0.001, Math.min(1, (w * h) / 10000));
    }

    function clamp(value) {
        return Math.max(0, Math.min(1, value));
    }

    function clampToRange(value, min, max) {
        return Math.max(min, Math.min(value, max));
    }

    function distance(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function setTransportState(kind, message) {
        transportStateEl.className = kind;
        transportStateEl.textContent = message;
    }
})();
