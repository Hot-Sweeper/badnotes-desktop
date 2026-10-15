// ============== Liquid Magnet Effects ==============
// Kit-native magnetic engine adapted for BadNotes controls.

(function() {
    'use strict';

    if (window.__badnotesLiquidMagnetInit) return;
    window.__badnotesLiquidMagnetInit = true;

    const DEFAULT_TRANSFORM = 'translate3d(0, 0, 0) rotateX(0deg) rotateY(0deg) scale(1) translateZ(0px)';
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    function vibrate(pattern) {
        if (navigator.vibrate) navigator.vibrate(pattern);
    }

    function liquidMagnet(element, hitbox, opts = {}) {
        let {
            pull = 0.18,
            tilt = 14,
            squish = 0.92,
            popZ = 8,
            reshape = true,
            baseRadius = 12,
            reshapeAmt = 0.35,
            proximity = 0
        } = opts;

        let cx = 0, cy = 0, cRotX = 0, cRotY = 0, cScale = 1, cZ = 0;
        let tx = 0, ty = 0, tRotX = 0, tRotY = 0, tScale = 1, tZ = 0;
        let cr = [baseRadius, baseRadius, baseRadius, baseRadius];
        let tr = [baseRadius, baseRadius, baseRadius, baseRadius];
        let vr = [0, 0, 0, 0];
        let vScale = 0;
        let vx = 0, vy = 0, vRotX = 0, vRotY = 0, vZ = 0;
        let hovered = false, pressed = false, rafId = null;

        function writeTransform() {
            element.style.setProperty(
                '--lm-transform',
                `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0) rotateX(${cRotX.toFixed(2)}deg) rotateY(${cRotY.toFixed(2)}deg) scale(${cScale.toFixed(4)}) translateZ(${cZ.toFixed(2)}px)`
            );
        }

        function tick() {
            const tension = 0.12;
            const friction = 0.75;

            vx += (tx - cx) * tension;
            vx *= friction;
            cx += vx;

            vy += (ty - cy) * tension;
            vy *= friction;
            cy += vy;

            vRotX += (tRotX - cRotX) * tension;
            vRotX *= friction;
            cRotX += vRotX;

            vRotY += (tRotY - cRotY) * tension;
            vRotY *= friction;
            cRotY += vRotY;

            vZ += (tZ - cZ) * tension;
            vZ *= friction;
            cZ += vZ;

            vScale += (tScale - cScale) * 0.15;
            vScale *= 0.75;
            cScale += vScale;

            cr = cr.map((radius, i) => {
                vr[i] += (tr[i] - radius) * 0.12;
                vr[i] *= 0.75;
                return radius + vr[i];
            });

            writeTransform();

            if (reshape) {
                element.style.borderRadius = `${cr[0]}px ${cr[1]}px ${cr[2]}px ${cr[3]}px`;
            }

            const radiusMoving = cr.some((radius, i) => Math.abs(radius - tr[i]) > 0.1 || Math.abs(vr[i]) > 0.1);
            const transformMoving = Math.abs(cx - tx) > 0.1 || Math.abs(vx) > 0.1 ||
                Math.abs(cy - ty) > 0.1 || Math.abs(vy) > 0.1 ||
                Math.abs(cRotX - tRotX) > 0.1 || Math.abs(vRotX) > 0.1 ||
                Math.abs(cRotY - tRotY) > 0.1 || Math.abs(vRotY) > 0.1 ||
                Math.abs(cZ - tZ) > 0.1 || Math.abs(vZ) > 0.1;

            const moving = transformMoving || Math.abs(cScale - tScale) > 0.001 || Math.abs(vScale) > 0.001 || radiusMoving;

            if (moving) {
                rafId = requestAnimationFrame(tick);
            } else {
                if (tx === 0 && ty === 0 && tRotX === 0 && tRotY === 0 && tZ === 0 && tScale === 1) {
                    element.style.setProperty('--lm-transform', DEFAULT_TRANSFORM);
                }
                rafId = null;
            }
        }

        function startTick() {
            if (!rafId) rafId = requestAnimationFrame(tick);
        }

        function computeReshape(nx, ny, intensity = 1) {
            if (!reshape) return [baseRadius, baseRadius, baseRadius, baseRadius];

            const ease = (value) => Math.sign(value) * Math.pow(Math.abs(value), 1.8);
            const ex = ease(nx);
            const ey = ease(ny);
            const r = reshapeAmt * intensity * 25;

            const minR = baseRadius * 0.96;
            const maxR = baseRadius * 1.06;
            const maxPosDelta = maxR - baseRadius;
            const maxNegDelta = baseRadius - minR;

            const softDelta = (rawDelta) => {
                if (rawDelta > 0) return maxPosDelta * Math.tanh(rawDelta / maxPosDelta);
                return -maxNegDelta * Math.tanh(Math.abs(rawDelta) / maxNegDelta);
            };

            return [
                baseRadius + softDelta((-ex - ey) * r),
                baseRadius + softDelta(( ex - ey) * r),
                baseRadius + softDelta(( ex + ey) * r),
                baseRadius + softDelta((-ex + ey) * r)
            ];
        }

        let cachedRect = null;
        let lastScrollY = window.scrollY;
        let lastScrollX = window.scrollX;

        const getRect = () => {
            if (!cachedRect || window.scrollY !== lastScrollY || window.scrollX !== lastScrollX) {
                const previousTransform = hitbox.style.transform;
                hitbox.style.transform = '';
                cachedRect = hitbox.getBoundingClientRect();
                hitbox.style.transform = previousTransform;
                lastScrollY = window.scrollY;
                lastScrollX = window.scrollX;
            }
            return cachedRect;
        };

        function setGlowPosition(clientX, clientY, rect) {
            element.style.setProperty('--lm-x', `${((clientX - rect.left) / rect.width * 100).toFixed(1)}%`);
            element.style.setProperty('--lm-y', `${((clientY - rect.top) / rect.height * 100).toFixed(1)}%`);
        }

        const instance = {
            clearCache: () => {
                cachedRect = null;
            },
            forceRelease: () => {
                hovered = false;
                pressed = false;
                element.classList.remove('lm-active');
                tScale = 1;
                tZ = 0;
                tx = 0;
                ty = 0;
                tRotX = 0;
                tRotY = 0;
                tr = [baseRadius, baseRadius, baseRadius, baseRadius];
                startTick();
            },
            checkHover: (clientX, clientY) => {
                const rect = getRect();
                const midX = rect.left + rect.width / 2;
                const midY = rect.top + rect.height / 2;
                const isInside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;

                if (isInside) {
                    if (!hovered) {
                        hovered = true;
                        element.classList.add('lm-active');
                        if (!pressed) tZ = popZ;
                    }

                    const dx = clientX - midX;
                    const dy = clientY - midY;
                    const nx = clamp(dx / (rect.width / 2), -1, 1);
                    const ny = clamp(dy / (rect.height / 2), -1, 1);

                    tx = dx * (pull * 0.4);
                    ty = dy * (pull * 0.4);
                    tRotY = nx * (tilt * 0.4);
                    tRotX = -ny * (tilt * 0.4);
                    tr = computeReshape(nx, ny, 1);

                    setGlowPosition(clientX, clientY, rect);
                    startTick();
                    return;
                }

                if (hovered) {
                    hovered = false;
                    element.classList.remove('lm-active');
                    if (!pressed) {
                        tZ = 0;
                        tRotX = 0;
                        tRotY = 0;
                    }
                }

                if (proximity > 0) {
                    const dxEdge = Math.max(rect.left - clientX, 0, clientX - rect.right);
                    const dyEdge = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
                    const distance = Math.sqrt(dxEdge * dxEdge + dyEdge * dyEdge);

                    if (distance < proximity) {
                        let intensity = 1 - (distance / proximity);
                        intensity *= intensity;

                        const dx = clientX - midX;
                        const dy = clientY - midY;
                        const nx = clamp(dx / (rect.width / 2), -2, 2);
                        const ny = clamp(dy / (rect.height / 2), -2, 2);

                        tx = dx * (pull * 0.4) * intensity;
                        ty = dy * (pull * 0.4) * intensity;
                        tr = computeReshape(nx, ny, intensity);
                        startTick();
                        return;
                    }
                }

                if (tx !== 0 || ty !== 0 || tr.some((radius) => radius !== baseRadius)) {
                    tx = 0;
                    ty = 0;
                    tr = [baseRadius, baseRadius, baseRadius, baseRadius];
                    if (!pressed) {
                        tRotX = 0;
                        tRotY = 0;
                        tZ = 0;
                        tScale = 1;
                    }
                    startTick();
                }
            }
        };

        if (!window._badnotesLiquidMagnets) {
            window._badnotesLiquidMagnets = [];
            let ticking = false;
            let mx = window.innerWidth / 2;
            let my = window.innerHeight / 2;

            window.addEventListener('mousemove', (e) => {
                mx = e.clientX;
                my = e.clientY;
                if (!ticking) {
                    requestAnimationFrame(() => {
                        window._badnotesLiquidMagnets.forEach((magnet) => magnet.checkHover(mx, my));
                        ticking = false;
                    });
                    ticking = true;
                }
            }, { passive: true });

            window.addEventListener('touchmove', (e) => {
                if (!e.touches || !e.touches.length) return;
                mx = e.touches[0].clientX;
                my = e.touches[0].clientY;
                if (!ticking) {
                    requestAnimationFrame(() => {
                        window._badnotesLiquidMagnets.forEach((magnet) => magnet.checkHover(mx, my));
                        ticking = false;
                    });
                    ticking = true;
                }
            }, { passive: true });

            const releaseAll = () => {
                window._badnotesLiquidMagnets.forEach((magnet) => {
                    if (typeof magnet.forceRelease === 'function') {
                        magnet.forceRelease();
                    }
                });
            };

            window.addEventListener('touchend', releaseAll, { passive: true });
            window.addEventListener('touchcancel', releaseAll, { passive: true });

            const clearAllCaches = () => {
                window._badnotesLiquidMagnets.forEach((magnet) => magnet.clearCache());
            };

            window.addEventListener('resize', clearAllCaches, { passive: true });
            window.addEventListener('scroll', clearAllCaches, { passive: true });
            window.addEventListener('click', () => {
                setTimeout(clearAllCaches, 50);
                setTimeout(clearAllCaches, 250);
                setTimeout(clearAllCaches, 550);
            }, { passive: true });
        }

        window._badnotesLiquidMagnets.push(instance);

        element.addEventListener('mousedown', (e) => {
            pressed = true;
            hovered = true;
            element.classList.add('lm-active');
            tScale = squish;
            tZ = -popZ;

            const rect = getRect();
            const midX = rect.left + rect.width / 2;
            const midY = rect.top + rect.height / 2;
            const nx = clamp((e.clientX - midX) / (rect.width / 2), -1, 1);
            const ny = clamp((e.clientY - midY) / (rect.height / 2), -1, 1);

            tRotY = nx * (tilt * 0.4) * 1.5;
            tRotX = -ny * (tilt * 0.4) * 1.5;
            setGlowPosition(e.clientX, e.clientY, rect);

            vibrate(15);
            startTick();
        });

        window.addEventListener('mouseup', () => {
            if (!pressed) return;
            pressed = false;
            tScale = 1;
            tZ = hovered ? popZ : 0;
            if (!hovered) element.classList.remove('lm-active');
            startTick();
        });

        element.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            const rect = getRect();
            const midX = rect.left + rect.width / 2;
            const midY = rect.top + rect.height / 2;
            const nx = clamp((touch.clientX - midX) / (rect.width / 2), -1, 1);
            const ny = clamp((touch.clientY - midY) / (rect.height / 2), -1, 1);
            const dx = touch.clientX - midX;
            const dy = touch.clientY - midY;

            hovered = true;
            pressed = true;
            element.classList.add('lm-active');
            tScale = squish;
            tZ = -popZ;
            tx = dx * (pull * 0.4);
            ty = dy * (pull * 0.4);
            tRotY = nx * (tilt * 0.4) * 1.5;
            tRotX = -ny * (tilt * 0.4) * 1.5;
            tr = computeReshape(nx, ny, 1);

            setGlowPosition(touch.clientX, touch.clientY, rect);
            vibrate(15);
            startTick();
        }, { passive: true });

        element.addEventListener('touchmove', (e) => {
            if (!pressed) return;
            const touch = e.touches[0];
            const rect = getRect();
            const midX = rect.left + rect.width / 2;
            const midY = rect.top + rect.height / 2;
            const nx = clamp((touch.clientX - midX) / (rect.width / 2), -1, 1);
            const ny = clamp((touch.clientY - midY) / (rect.height / 2), -1, 1);
            const dx = touch.clientX - midX;
            const dy = touch.clientY - midY;

            tRotY = nx * (tilt * 0.4) * 1.5;
            tRotX = -ny * (tilt * 0.4) * 1.5;
            tr = computeReshape(nx, ny, 0.7);

            const isInside = touch.clientX >= rect.left && touch.clientX <= rect.right &&
                touch.clientY >= rect.top && touch.clientY <= rect.bottom;
            if (isInside) {
                tx = dx * (pull * 0.4);
                ty = dy * (pull * 0.4);
            }

            setGlowPosition(touch.clientX, touch.clientY, rect);
            startTick();
        }, { passive: true });

        const endTouch = () => {
            instance.forceRelease();
        };

        element.addEventListener('touchend', endTouch, { passive: true });
        element.addEventListener('touchcancel', endTouch, { passive: true });

        startTick();
        return instance;
    }

    function initLiquidMagnetEffects() {
        const targets = [
            { selector: '#recycleBinBtn', opts: { pull: 0.22, tilt: 16, squish: 0.91, popZ: 12, baseRadius: 30, reshapeAmt: 0.28, proximity: 120 } },
            { selector: '#toolboxBtn', opts: { pull: 0.22, tilt: 16, squish: 0.91, popZ: 12, baseRadius: 30, reshapeAmt: 0.28, proximity: 120 } }
        ];

        targets.forEach(({ selector, opts }) => {
            const el = document.querySelector(selector);
            if (!el) return;
            liquidMagnet(el, el, opts);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLiquidMagnetEffects);
    } else {
        initLiquidMagnetEffects();
    }
})();
