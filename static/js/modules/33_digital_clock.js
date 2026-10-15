// ============== Digital Clock Module ==============
// Optional calendar timetable with second-accurate countdowns and a one-minute feed refresh.

(function() {
    'use strict';

    const FEED_URL = '/api/timetable';
    let timetableEvents = [];
    let feedFetchedAt = null;
    let feedStale = false;
    let feedError = false;

    const CALENDAR_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const calendarDateFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: CALENDAR_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const calendarDayFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: CALENDAR_TIME_ZONE, weekday: 'short'
    });
    const dateFormatter = new Intl.DateTimeFormat('de-DE', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
    });
    const feedTimeFormatter = new Intl.DateTimeFormat('de-DE', {hour:'2-digit',minute:'2-digit'});
    const calendarDateKey = date => {
        const parts = calendarDateFormatter.formatToParts(date);
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}`;
    };

    // The feed's ISO timestamp is already in calendar local time.
    const lessonTime = lesson => lesson.start.slice(11, 16);
    const lessonDetail = lesson => [lesson.teacher, lesson.room].filter(Boolean).join(' · ');

    const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));

    function fmtDuration(totalSeconds) {
        const sec = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
        return `${s}s`;
    }

    function fmtClockCountdown(totalSeconds) {
        const sec = Math.max(0, Math.floor(totalSeconds));
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    function getTimetableModel(now) {
        const today = calendarDateKey(now);
        const lessons = timetableEvents.filter(lesson => calendarDateKey(new Date(lesson.start)) === today);
        const nextAny = timetableEvents.find(lesson => Date.parse(lesson.start) > now.getTime());
        const lessonCount = lessons.length;
        const dayLabel = calendarDayFormatter.format(now);

        if (feedError && !timetableEvents.length) {
            return { mode: 'off', stateLabel: 'Offline', short: 'Calendar timetable unavailable',
                dayLabel, lessonCount: 0, cards: [], progress: 0 };
        }
        if (!feedFetchedAt) {
            return { mode: 'off', stateLabel: 'Loading', short: 'Loading Calendar timetable',
                dayLabel, lessonCount: 0, cards: [], progress: 0 };
        }

        if (!lessons.length) {
            return {
                mode: 'off',
                stateLabel: 'Free',
                short: nextAny
                    ? `Next ${formatEventDay(nextAny)} ${lessonTime(nextAny)} Calendar`
                    : 'No class',
                dayLabel,
                lessonCount,
                cards: [],
                progress: 0
            };
        }

        for (let i = 0; i < lessons.length; i++) {
            const lesson = lessons[i];
            const startSec = Date.parse(lesson.start) / 1000;
            const endSec = Date.parse(lesson.end) / 1000;
            const nowSeconds = now.getTime() / 1000;

            if (nowSeconds >= startSec && nowSeconds < endSec) {
                const remainingSec = endSec - nowSeconds;
                const elapsedSec = nowSeconds - startSec;
                const totalSec = Math.max(1, endSec - startSec);
                const nextLesson = timetableEvents.find(item => Date.parse(item.start) >= endSec * 1000);

                const cards = [];
                cards.push({
                    type: 'now',
                    subject: lesson.subject,
                    detail: `${lessonTime(lesson)} Calendar · ${lessonDetail(lesson)}`,
                    countdown: fmtDuration(remainingSec),
                    countdownLabel: 'left'
                });
                if (nextLesson) {
                    cards.push({
                        type: 'next',
                        subject: nextLesson.subject,
                        detail: `${formatEventDay(nextLesson)} ${lessonTime(nextLesson)} Calendar · ${lessonDetail(nextLesson)}`,
                        countdown: fmtDuration((Date.parse(nextLesson.start) / 1000) - nowSeconds),
                        countdownLabel: 'until'
                    });
                }

                return {
                    mode: 'class',
                    stateLabel: 'In Class',
                    short: `${lesson.subject} · ${fmtClockCountdown(remainingSec)}`,
                    dayLabel,
                    lessonCount,
                    cards,
                    progress: Math.min(100, Math.max(0, (elapsedSec / totalSec) * 100)),
                };
            }

            if (nowSeconds < startSec) {
                const prev = i > 0 ? lessons[i - 1] : null;
                const toNextSec = startSec - nowSeconds;
                const isBreak = !!prev && nowSeconds >= Date.parse(prev.end) / 1000;
                const breakStartSec = prev ? Date.parse(prev.end) / 1000 : startSec;
                const breakTotalSec = Math.max(1, startSec - breakStartSec);
                const breakElapsedSec = Math.max(0, nowSeconds - breakStartSec);

                const cards = [];
                cards.push({
                    type: 'next',
                    subject: lesson.subject,
                    detail: `${lessonTime(lesson)} Calendar · ${lessonDetail(lesson)}`,
                    countdown: fmtDuration(toNextSec),
                    countdownLabel: isBreak ? 'after break' : 'starts in'
                });

                return {
                    mode: isBreak ? 'break' : 'off',
                    stateLabel: isBreak ? 'Break' : 'Before Class',
                    short: isBreak ? `Break · ${fmtClockCountdown(toNextSec)}` : `Next ${lessonTime(lesson)} Calendar`,
                    dayLabel,
                    lessonCount,
                    cards,
                    progress: isBreak ? Math.min(100, Math.max(0, (breakElapsedSec / breakTotalSec) * 100)) : 0,
                };
            }
        }

        return {
            mode: 'off',
            stateLabel: 'Done',
            short: nextAny
                ? `Done · Next ${formatEventDay(nextAny)} ${lessonTime(nextAny)} Calendar`
                : 'Done',
            dayLabel,
            lessonCount,
            cards: [{
                type: 'next',
                subject: 'Done for today',
                detail: nextAny ? `Next: ${formatEventDay(nextAny)} ${lessonTime(nextAny)} Calendar · ${nextAny.subject}` : 'No further classes listed',
                countdown: '',
                countdownLabel: ''
            }],
            progress: 100
        };
    }

    function formatEventDay(lesson) {
        const date = new Date(lesson.start);
        return calendarDayFormatter.format(date);
    }

    function formatClock(now) {
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    }

    function formatDate(now) {
        return dateFormatter.format(now);
    }

    function renderCard(card) {
        const isHighlight = card.type === 'now';
        return `<div class="clock-card clock-card--${card.type}${isHighlight ? ' clock-card--active' : ''}">
            <div class="clock-card-body">
                <div class="clock-card-subject">${escapeHtml(card.subject)}</div>
                <div class="clock-card-detail">${escapeHtml(card.detail)}</div>
            </div>
            ${card.countdown ? `<div class="clock-card-countdown">
                <span class="clock-card-countdown-val">${card.countdown}</span>
                <span class="clock-card-countdown-label">${card.countdownLabel}</span>
            </div>` : ''}
        </div>`;
    }

    function initDigitalClock() {
        const clockEl = document.getElementById('digitalClock');
        const timeEl = document.getElementById('digitalClockTime');
        const dateEl = document.getElementById('digitalClockDate');
        const statusEl = document.getElementById('digitalClockStatus');
        const daySummaryEl = document.getElementById('clockDaySummary');
        const statePillEl = document.getElementById('clockStatePill');
        const feedStatusEl = document.getElementById('clockFeedStatus');
        const cardsEl = document.getElementById('clockCards');
        const progressBarEl = document.getElementById('clockProgressBar');

        if (
            !clockEl || !timeEl || !dateEl || !statusEl ||
            !daySummaryEl || !statePillEl || !feedStatusEl || !cardsEl ||
            !progressBarEl
        ) return;

        let timerId = null;
        let lastRefreshAttempt = 0;

        let isExpanded = false;

        // Clock updates must not count as interaction: the one-second tick
        // must never restart the clock's tuck-away timer.
        const idleMs = 3000;
        let idleTimer = null;
        let hovered = false;
        const contacts = new Set();
        const revealZone = document.createElement('div');
        revealZone.className = 'clock-reveal-zone';
        revealZone.setAttribute('aria-hidden', 'true');
        revealZone.hidden = true;
        clockEl.after(revealZone);
        clockEl.title = 'Clock and timetable';

        const clearIdle = () => {
            if (idleTimer !== null) clearTimeout(idleTimer);
            idleTimer = null;
        };
        const embed = () => {
            clearIdle();
            if (isExpanded || hovered || contacts.size || clockEl.matches(':focus-visible')) return;
            clockEl.classList.add('is-embedded');
            revealZone.hidden = false;
        };
        const armIdle = () => {
            clearIdle();
            if (document.hidden || isExpanded || hovered || contacts.size || clockEl.matches(':focus-visible')) return;
            idleTimer = setTimeout(embed, idleMs);
        };
        const reveal = () => {
            clockEl.classList.remove('is-embedded');
            revealZone.hidden = true;
            armIdle();
        };
        new ResizeObserver(() => {
            // Layout width, not a per-frame transformed bounding box.
            revealZone.style.width = Math.max(140, clockEl.offsetWidth + 32) + 'px';
        }).observe(clockEl);
        revealZone.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') reveal(); });
        revealZone.addEventListener('pointerdown', e => { e.preventDefault(); reveal(); });
        revealZone.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
        clockEl.addEventListener('pointerenter', e => {
            if (e.pointerType !== 'touch') { hovered = true; reveal(); }
        });
        clockEl.addEventListener('pointerleave', () => { hovered = false; armIdle(); });
        clockEl.addEventListener('pointerdown', e => { contacts.add(e.pointerId); reveal(); });
        const releaseContact = e => { if (contacts.delete(e.pointerId)) armIdle(); };
        document.addEventListener('pointerup', releaseContact, true);
        document.addEventListener('pointercancel', releaseContact, true);
        clockEl.addEventListener('focusin', reveal);
        clockEl.addEventListener('focusout', armIdle);
        window.addEventListener('blur', () => { hovered = false; contacts.clear(); armIdle(); });
        document.addEventListener('visibilitychange', () => { if (document.hidden) clearIdle(); else armIdle(); });

        const applyExpanded = () => {
            clockEl.classList.toggle('is-expanded', isExpanded);
            clockEl.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            if (isExpanded) reveal();
            else armIdle();
        };

        const toggleExpanded = () => {
            isExpanded = !isExpanded;
            if (isExpanded) render(); // Fresh countdowns before the first visible frame.
            applyExpanded();
        };

        clockEl.addEventListener('click', toggleExpanded);
        document.addEventListener('pointerdown', e => {
            if (isExpanded && !clockEl.contains(e.target) && !revealZone.contains(e.target)) {
                isExpanded = false;
                applyExpanded();
            }
        }, true);
        clockEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleExpanded();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                isExpanded = false;
                applyExpanded();
                clockEl.blur();
            }
        });

        let lastDateKey = '',lastCards = '',lastMode = '';
        const text = (element,value) => {
            if(element.textContent===value)return;
            if(element.childNodes.length===1&&element.firstChild.nodeType===Node.TEXT_NODE)element.firstChild.data=value;
            else element.textContent=value;
        };
        const render = (forceDetails = false) => {
            const now = new Date();
            text(timeEl,formatClock(now));
            const dateKey = `${now.getFullYear()}:${now.getMonth()}:${now.getDate()}`;
            if(dateKey!==lastDateKey){lastDateKey=dateKey;text(dateEl,formatDate(now));}
            // Seconds still tick exactly as before, but a closed timetable has
            // no visible countdowns/cards to rebuild. Opening renders it above.
            if(!isExpanded&&!forceDetails)return;

            const model = getTimetableModel(now);
            text(statusEl,model.short);
            text(daySummaryEl,`${model.dayLabel} · ${model.lessonCount} lesson${model.lessonCount === 1 ? '' : 's'}`);
            text(statePillEl,model.stateLabel);
            const updated = feedFetchedAt ? feedTimeFormatter.format(new Date(feedFetchedAt)) : '';
            text(feedStatusEl,feedError && !feedFetchedAt
                ? 'Calendar unavailable'
                : feedStale || feedError
                    ? `Calendar cached · updated ${updated}`
                    : feedFetchedAt ? `Calendar updated ${updated}` : 'Loading calendar');
            const cards=model.cards.map(renderCard).join('');
            if(cards!==lastCards){cardsEl.innerHTML=cards;lastCards=cards;}
            const progress=`${model.progress.toFixed(2)}%`;
            if(progressBarEl.style.width!==progress)progressBarEl.style.width=progress;

            if(model.mode!==lastMode){
                clockEl.classList.remove('clock-mode-class', 'clock-mode-break', 'clock-mode-off');
                clockEl.classList.add('clock-mode-'+model.mode);lastMode=model.mode;
            }
        };

        const refreshFeed = async () => {
            lastRefreshAttempt = Date.now();
            try {
                const response = await fetch(FEED_URL, { cache: 'no-store' });
                if (!response.ok) throw new Error(`Calendar feed: ${response.status}`);
                const data = await response.json();
                if (!Array.isArray(data.events)) throw new Error('Invalid Calendar feed');
                timetableEvents = data.events.filter(event =>
                    Number.isFinite(Date.parse(event.start)) && Number.isFinite(Date.parse(event.end))
                ).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
                feedFetchedAt = data.fetched_at;
                feedStale = !!data.stale;
                feedError = false;
            } catch (error) {
                feedError = true;
                console.warn('Calendar timetable refresh failed:', error);
            }
            render(true);
        };

        const scheduleNextTick = () => {
            const now = Date.now();
            const msToNextSecond = 1000 - (now % 1000);
            timerId = window.setTimeout(() => {
                render();
                scheduleNextTick();
            }, msToNextSecond);
        };

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (timerId) {
                    clearTimeout(timerId);
                    timerId = null;
                }
                return;
            }
            render(true);
            if (Date.now() - lastRefreshAttempt > 60000) refreshFeed();
            if (!timerId) {
                scheduleNextTick();
            }
        });

        applyExpanded();
        render(true);
        scheduleNextTick();
        refreshFeed();
        window.setInterval(() => { if(!document.hidden)refreshFeed(); }, 60000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDigitalClock);
    } else {
        initDigitalClock();
    }
})();
