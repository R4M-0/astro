'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, ChevronLeft, ChevronRight, ClipboardList, HardHat, Pause, SkipForward, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { markSeen, type AttentionItem } from '@/components/dashboards/signage';
import { apiGet, apiPatch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { paintFrame, SPRITE_H, SPRITE_W, type Pose } from './sprite';
import { useWorkshopBoard } from './use-workshop-board';

export type TipTone = 'alert' | 'warn' | 'todo' | 'info' | 'ok';

export interface MascotTip {
  id: string;
  text: string;
  tone: TipTone;
  href?: string;
}

interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
}

type Mode = 'idle' | 'walk' | 'jump' | 'laugh' | 'wave' | 'think' | 'talk' | 'sleep' | 'surprised' | 'celebrate';

type Bubble =
  | { kind: 'tip'; index: number }
  | { kind: 'say'; text: string; tone?: TipTone; href?: string }
  | { kind: 'round' }
  | { kind: 'mail'; n: Notification }
  | { kind: 'thought' }
  | { kind: 'zzz' }
  | null;

/** The daily round: a snapshot of the attention items, walked one page at a time. */
interface Round {
  day: string;
  items: AttentionItem[];
  index: number;
  done: string[];
  skipped: string[];
  active: boolean;
}

const SCALE = 5;
const W = SPRITE_W * SCALE; // 80
const H = SPRITE_H * SCALE; // 120
const SPEED = 38; // px / s
const SLEEP_AFTER = 70_000;
const BUBBLE_TTL = 11_000;

// ---------------------------------------------------------------- small persisted stores
function storedFlag(key: string) {
  const listeners = new Set<() => void>();
  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get: () => {
      try {
        return localStorage.getItem(key) === '1';
      } catch {
        return false;
      }
    },
    set: (v: boolean) => {
      try {
        localStorage.setItem(key, v ? '1' : '0');
      } catch {
        /* storage unavailable: the toggle still works for this page view */
      }
      listeners.forEach((l) => l());
    },
  };
}

const hiddenStore = storedFlag('astro.mascot.hidden');

/** Whether Gus is put away (the layout reserves floor space only while he's out). */
export function useMascotHidden() {
  return useSyncExternalStore(hiddenStore.subscribe, hiddenStore.get, () => true);
}

const ROUND_KEY = 'astro.mascot.round';
const todayKey = () => new Date().toISOString().slice(0, 10);
function loadRound(): Round | null {
  try {
    const r = JSON.parse(localStorage.getItem(ROUND_KEY) ?? 'null') as Round | null;
    return r && r.day === todayKey() ? r : null;
  } catch {
    return null;
  }
}
function saveRound(r: Round | null) {
  try {
    if (r) localStorage.setItem(ROUND_KEY, JSON.stringify(r));
    else localStorage.removeItem(ROUND_KEY);
  } catch {
    /* in-memory only */
  }
}

const motionQuery = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (l: () => void) => {
  const mq = window.matchMedia(motionQuery);
  mq.addEventListener('change', l);
  return () => mq.removeEventListener('change', l);
};

const TONE_DOT: Record<TipTone, string> = {
  alert: 'bg-destructive',
  warn: 'bg-warning',
  todo: 'bg-primary',
  info: 'bg-foreground/70',
  ok: 'bg-success',
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** first two path segments: `/hr/journeys/123` and `/hr/journeys` are the same page family */
const section = (path: string) => path.split('?')[0].split('/').slice(0, 3).join('/');

interface Engine {
  x: number;
  y: number;
  facing: 1 | -1;
  target: number;
  mode: Mode;
  t: number;
  until: number;
  blink: number;
  blinking: number;
  shake: number;
  lastInput: number;
  hovered: boolean;
  holding: Pose['holding'];
  onDone: (() => void) | null;
}

const btn =
  'inline-flex h-7 items-center gap-1 rounded-[3px] px-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * Gus — a pixel-art shop foreman who patrols a strip of floor tape in the lower-right corner of every
 * page. His jobs: run the daily round of what needs attention (page by page, with progress), deliver
 * new notifications the moment they arrive, and inspect each page for pending items.
 * Click: jump + report. Triple-click: laugh. Hover: waves. Idle for a while: dozes off.
 */
export function WorkshopMascot() {
  const t = useTranslations('mascot');
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const user = useSession((s) => s.user);
  const hidden = useMascotHidden();
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);
  const { items, tips, isSuccess: boardReady } = useWorkshopBoard();
  const { data: notifications } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => apiGet<Notification[]>('/notifications'),
  });

  const zoneRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLButtonElement>(null);
  const shadowRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLSpanElement>(null);
  const clicksRef = useRef<number[]>([]);
  const tipCursor = useRef(-1);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleHeld = useRef(false);
  const quipCursor = useRef(0);

  const [bubble, setBubble] = useState<Bubble>(null);
  const bubbleRefState = useRef<Bubble>(null);
  const [round, setRoundState] = useState<Round | null>(loadRound);

  const eng = useRef<Engine>({
    x: 0,
    y: 0,
    facing: -1,
    target: 0,
    mode: 'idle',
    t: 0,
    until: 1200,
    blink: 2500,
    blinking: 0,
    shake: 0,
    lastInput: 0,
    hovered: false,
    holding: undefined,
    onDone: null,
  });

  // live values the animation loop reads without restarting
  const quips = t.raw('quips') as string[];
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'greetMorning' : hour < 18 ? 'greetAfternoon' : 'greetEvening', { name: user?.firstName ?? '' });
  const live = useRef({ tips, quips, greeting, round });
  useEffect(() => {
    live.current = { tips, quips, greeting, round };
  }, [tips, quips, greeting, round]);

  const setRound = useCallback((r: Round | null) => {
    saveRound(r);
    setRoundState(r);
  }, []);

  // ---------------------------------------------------------------- bubble helpers
  const clearBubbleTimer = () => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = null;
  };
  const armBubbleTimer = useCallback(() => {
    clearBubbleTimer();
    const expire = () => {
      // a bubble under the pointer or keyboard focus stays open; check again shortly
      if (bubbleHeld.current) {
        bubbleTimer.current = setTimeout(expire, 2000);
        return;
      }
      bubbleRefState.current = null;
      setBubble((b) => (b && (b.kind === 'tip' || b.kind === 'say') ? null : b));
    };
    bubbleTimer.current = setTimeout(expire, BUBBLE_TTL);
  }, []);

  const say = useCallback(
    (b: Exclude<Bubble, null>) => {
      bubbleRefState.current = b;
      setBubble(b);
      if (b.kind === 'tip' || b.kind === 'say') armBubbleTimer();
      else clearBubbleTimer();
    },
    [armBubbleTimer],
  );

  const closeBubble = useCallback(() => {
    clearBubbleTimer();
    bubbleRefState.current = null;
    setBubble(null);
  }, []);

  const setMode = useCallback((mode: Mode, until: number, onDone: (() => void) | null = null) => {
    const e = eng.current;
    e.mode = mode;
    e.t = 0;
    e.until = until;
    e.onDone = onDone;
  }, []);

  const nextQuip = useCallback(() => {
    const list = live.current.quips;
    return list[quipCursor.current++ % list.length];
  }, []);

  /** speak a tip with a reaction that matches its tone */
  const deliverTip = useCallback(
    (index: number) => {
      const list = live.current.tips;
      if (!list.length) return;
      const i = ((index % list.length) + list.length) % list.length;
      tipCursor.current = i;
      const tip = list[i];
      const speak = () => {
        say({ kind: 'tip', index: i });
        setMode('talk', 1500, () => {
          if (tip.tone === 'ok') setMode('celebrate', 1300);
        });
      };
      if (tip.tone === 'alert') setMode('surprised', 520, speak);
      else speak();
    },
    [say, setMode],
  );

  const thinkThen = useCallback(
    (then: () => void) => {
      say({ kind: 'thought' });
      setMode('think', 2000, then);
    },
    [say, setMode],
  );

  // ---------------------------------------------------------------- job 1: the daily round
  const goToStep = useCallback(
    (r: Round) => {
      const item = r.items[r.index];
      eng.current.holding = 'clipboard';
      router.push(item.href);
      say({ kind: 'round' });
      setMode('jump', 650, () => setMode('talk', 1200));
    },
    [router, say, setMode],
  );

  const startRound = () => {
    if (!items.length) return;
    const r: Round = { day: todayKey(), items, index: 0, done: [], skipped: [], active: true };
    setRound(r);
    say({ kind: 'say', text: t('roundIntro', { count: items.length }) });
    eng.current.holding = 'clipboard';
    setMode('wave', 1400, () => goToStep(r));
  };

  const resumeRound = () => {
    if (!round) return;
    const r = { ...round, active: true };
    setRound(r);
    goToStep(r);
  };

  const advanceRound = (outcome: 'done' | 'skipped') => {
    if (!round) return;
    const item = round.items[round.index];
    if (outcome === 'done') markSeen(item.id);
    const r: Round = {
      ...round,
      index: round.index + 1,
      done: outcome === 'done' ? [...round.done, item.id] : round.done,
      skipped: outcome === 'skipped' ? [...round.skipped, item.id] : round.skipped,
    };
    if (r.index >= r.items.length) {
      setRound({ ...r, active: false });
      eng.current.holding = undefined;
      say({ kind: 'say', tone: 'ok', text: t('roundFinished', { done: r.done.length, skipped: r.skipped.length }) });
      setMode('celebrate', 1950);
      return;
    }
    setRound(r);
    goToStep(r);
  };

  const pauseRound = () => {
    if (!round) return;
    setRound({ ...round, active: false });
    eng.current.holding = undefined;
    say({ kind: 'say', text: t('roundPaused') });
    setMode('talk', 1200);
  };

  // ---------------------------------------------------------------- job 2: the postman
  const knownMail = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!notifications) return;
    if (knownMail.current === null) {
      // what was already there when Gus clocked in isn't news
      knownMail.current = new Set(notifications.map((n) => n.id));
      return;
    }
    const known = knownMail.current;
    const fresh = notifications.find((n) => !n.readAt && !known.has(n.id));
    notifications.forEach((n) => known.add(n.id));
    if (!fresh || hidden) return;
    const id = setTimeout(() => {
      eng.current.lastInput = performance.now();
      eng.current.holding = 'envelope';
      say({ kind: 'mail', n: fresh });
      setMode('surprised', 560, () => setMode('talk', 1400));
    }, 0);
    return () => clearTimeout(id);
  }, [notifications, hidden, say, setMode]);

  const markRead = useMutation({
    mutationFn: (id: string) => apiPatch(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const closeMail = () => {
    eng.current.holding = live.current.round?.active ? 'clipboard' : undefined;
    closeBubble();
  };

  // ---------------------------------------------------------------- job 3: page inspector
  const inspected = useRef(new Set<string>());
  useEffect(() => {
    if (hidden || !boardReady) return;
    const here = section(pathname);
    if (here === '/dashboard' || inspected.current.has(here)) return;
    const found = items.filter((i) => section(i.href) === here);
    if (!found.length) return;
    const id = setTimeout(() => {
      const e = eng.current;
      // never talk over another bubble, a running round or a nap
      if (bubbleRefState.current || live.current.round?.active || e.mode === 'sleep') return;
      inspected.current.add(here);
      thinkThen(() => {
        say({
          kind: 'say',
          tone: found[0].severity === 'alert' ? 'alert' : found[0].severity === 'warn' ? 'warn' : 'todo',
          text: t('pageHint', { count: found.length, title: found[0].title }),
          href: found[0].href,
        });
        setMode('talk', 1500);
      });
    }, 1500);
    return () => clearTimeout(id);
  }, [pathname, items, boardReady, hidden, say, setMode, thinkThen, t]);

  // ---------------------------------------------------------------- engine loop
  useEffect(() => {
    if (hidden) return;
    const canvas = canvasRef.current;
    const zone = zoneRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !zone || !ctx) return;

    const e = eng.current;
    const range = () => Math.max(0, zone.clientWidth - W);
    e.x = range();
    e.target = e.x;
    e.lastInput = performance.now();
    if (live.current.round?.active) e.holding = 'clipboard';

    let raf = 0;
    let last = performance.now();
    let autoTimer = rand(26000, 34000);
    let started = false;
    let greeted = false;
    try {
      greeted = sessionStorage.getItem('astro.mascot.greeted') === '1';
    } catch {
      /* greet every load */
    }

    const pose = (): Pose => {
      const p: Pose = { eyes: 'open', mouth: 'smile', arms: 'down', legs: 'stand', look: 0, holding: e.holding };
      const k = e.t;
      switch (e.mode) {
        case 'walk': {
          const f = Math.floor(k / 150) % 4;
          p.legs = f === 1 ? 'stepL' : f === 3 ? 'stepR' : 'stand';
          p.arms = f === 1 ? 'swing1' : f === 3 ? 'swing2' : 'down';
          p.mouth = 'neutral';
          p.look = 1;
          break;
        }
        case 'jump': {
          const r = k / e.until;
          p.legs = r < 0.14 || r > 0.88 ? 'crouch' : 'tuck';
          p.arms = r < 0.14 || r > 0.88 ? 'down' : 'up';
          p.eyes = r < 0.14 ? 'closed' : 'happy';
          p.mouth = 'open';
          break;
        }
        case 'surprised':
          p.eyes = 'wide';
          p.mouth = 'o';
          p.arms = 'up';
          p.legs = k < 90 ? 'crouch' : 'tuck';
          break;
        case 'laugh':
          p.eyes = 'happy';
          p.mouth = Math.floor(k / 120) % 2 ? 'open' : 'smile';
          p.cheeks = true;
          p.arms = Math.floor(k / 160) % 2 ? 'swing1' : 'swing2';
          p.holding = undefined;
          break;
        case 'celebrate':
          p.eyes = 'happy';
          p.mouth = 'open';
          p.cheeks = true;
          p.arms = 'up';
          p.legs = Math.floor(k / 325) % 2 ? 'tuck' : 'stand';
          break;
        case 'wave':
          p.arms = Math.floor(k / 220) % 2 ? 'wave2' : 'wave1';
          p.cheeks = true;
          break;
        case 'think':
          p.eyes = 'up';
          p.mouth = Math.floor(k / 700) % 2 ? 'flat' : 'o';
          p.arms = 'think';
          p.look = -1;
          p.holding = undefined;
          break;
        case 'talk':
          p.mouth = Math.floor(k / 130) % 2 ? 'open' : 'neutral';
          p.arms = k < 700 && !e.holding ? 'wave1' : 'down';
          break;
        case 'sleep':
          p.eyes = 'closed';
          p.mouth = Math.floor(k / 1400) % 2 ? 'o' : 'neutral';
          p.legs = 'crouch';
          break;
        default:
          break;
      }
      // raised arms can't hold anything
      if (p.arms === 'up' || p.arms.startsWith('wave')) p.holding = undefined;
      if (e.blinking > 0 && p.eyes === 'open') p.eyes = 'closed';
      return p;
    };

    let lastPoseKey = '';
    const draw = () => {
      const p = pose();
      const key = `${p.eyes}${p.mouth}${p.arms}${p.legs}${p.look}${p.cheeks}${p.holding}${e.facing}`;
      if (key !== lastPoseKey) {
        paintFrame(ctx, p, e.facing);
        lastPoseKey = key;
      }
      const sx = Math.round(e.x + e.shake);
      const sy = Math.round(e.y);
      if (spriteRef.current) spriteRef.current.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
      if (shadowRef.current) {
        const lift = Math.min(1, -e.y / 40);
        shadowRef.current.style.transform = `translate3d(${sx + 12}px, 0, 0) scaleX(${1 - lift * 0.45})`;
        shadowRef.current.style.opacity = String(0.32 - lift * 0.2);
      }
      const bub = bubbleRef.current;
      if (bub) {
        const zw = zone.clientWidth;
        const bw = bub.offsetWidth;
        const center = sx + W / 2;
        const left = Math.max(0, Math.min(zw - bw, center - bw / 2));
        bub.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(Math.min(0, sy))}px, 0)`;
        if (tailRef.current) tailRef.current.style.left = `${Math.round(Math.max(14, Math.min(bw - 26, center - left - 6)))}px`;
      }
    };

    const finish = () => {
      const done = e.onDone;
      e.onDone = null;
      e.y = 0;
      e.shake = 0;
      if (done) {
        done();
        if (e.t === 0 && e.mode !== 'idle') return; // the callback started a new mode
      }
      if (e.mode !== 'sleep') setMode('idle', rand(1400, 3800));
    };

    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      e.t += dt;

      if (e.blinking > 0) e.blinking -= dt;
      else if ((e.blink -= dt) <= 0) {
        e.blinking = 130;
        e.blink = rand(2200, 5600);
      }

      if (!started && e.t > 900) {
        started = true;
        if (!greeted && !bubbleRefState.current) {
          try {
            sessionStorage.setItem('astro.mascot.greeted', '1');
          } catch {
            /* fine */
          }
          say({ kind: 'say', text: live.current.greeting });
          setMode('wave', 1500);
        }
      }

      if (!reduced) {
        switch (e.mode) {
          case 'walk': {
            const d = e.target - e.x;
            if (Math.abs(d) < 1) finish();
            else {
              e.facing = d > 0 ? 1 : -1;
              e.x += Math.sign(d) * Math.min(Math.abs(d), (SPEED * dt) / 1000);
            }
            break;
          }
          case 'jump':
          case 'surprised': {
            const r = Math.min(1, e.t / e.until);
            const h = e.mode === 'jump' ? 40 : 22;
            e.y = r > 0.14 && r < 0.88 ? -Math.sin(((r - 0.14) / 0.74) * Math.PI) * h : 0;
            break;
          }
          case 'celebrate': {
            const ph = (e.t % 650) / 650;
            e.y = ph > 0.5 ? -Math.sin(((ph - 0.5) / 0.5) * Math.PI) * 16 : 0;
            break;
          }
          case 'laugh':
            e.shake = Math.floor(e.t / 70) % 2 ? SCALE / 2 : -SCALE / 2;
            break;
          default:
            break;
        }
      } else if (e.mode === 'walk') finish();

      if (e.mode !== 'walk' && e.mode !== 'sleep' && e.mode !== 'idle' && e.t >= e.until) finish();

      if (e.mode === 'idle' && !e.hovered && e.t >= e.until) {
        const idleFor = now - e.lastInput;
        if (idleFor > SLEEP_AFTER && !bubbleHeld.current && !bubbleRefState.current) {
          setMode('sleep', Infinity);
          say({ kind: 'zzz' });
        } else if (!reduced && Math.random() < 0.7) {
          const r = range();
          let target = rand(0, r);
          if (Math.abs(target - e.x) < 40) target = e.x > r / 2 ? rand(0, r / 3) : rand((2 * r) / 3, r);
          e.target = target;
          setMode('walk', Infinity);
        } else setMode('idle', rand(1500, 3500));
      }

      // unprompted check-ins: think, then report the next useful thing
      if (started && e.mode !== 'sleep' && !e.hovered) {
        autoTimer -= dt;
        if (autoTimer <= 0) {
          autoTimer = rand(32000, 46000);
          const busy = bubbleHeld.current || bubbleRefState.current || live.current.round?.active;
          if (!busy && (e.mode === 'idle' || e.mode === 'walk')) {
            if (live.current.tips.length) thinkThen(() => deliverTip(tipCursor.current + 1));
            else {
              say({ kind: 'say', text: nextQuip() });
              setMode('talk', 1400);
            }
          }
        }
      }

      draw();
      raf = requestAnimationFrame(step);
    };

    draw();
    raf = requestAnimationFrame(step);
    const onResize = () => {
      const r = range();
      e.x = Math.min(e.x, r);
      e.target = Math.min(e.target, r);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [hidden, reduced, say, setMode, thinkThen, deliverTip, nextQuip]);

  useEffect(() => () => clearBubbleTimer(), []);

  // ---------------------------------------------------------------- interactions
  const onActivate = () => {
    const e = eng.current;
    const now = performance.now();
    e.lastInput = now;
    clicksRef.current = [...clicksRef.current.filter((c) => now - c < 700), now];

    if (e.mode === 'sleep') {
      say({ kind: 'say', text: t('wake') });
      setMode('surprised', 560);
      return;
    }
    if (clicksRef.current.length >= 3) {
      clicksRef.current = [];
      say({ kind: 'say', text: t('laugh') });
      setMode('laugh', 1500);
      return;
    }
    // mid-round, Gus reopens the current stop
    if (round?.active) {
      say({ kind: 'round' });
      setMode('jump', 650);
      return;
    }
    if (!live.current.tips.length) {
      say({ kind: 'say', text: nextQuip() });
      setMode('jump', 650);
      return;
    }
    const nextIndex = tipCursor.current + 1;
    setMode('jump', 650, () => deliverTip(nextIndex));
  };

  const onHover = (over: boolean, clientX?: number) => {
    const e = eng.current;
    e.hovered = over;
    if (!over) return;
    e.lastInput = performance.now();
    if (e.mode === 'sleep') return;
    if (clientX !== undefined && zoneRef.current) {
      const box = zoneRef.current.getBoundingClientRect();
      e.facing = clientX - box.left > e.x + W / 2 ? 1 : -1;
    }
    if (e.mode === 'walk' || e.mode === 'idle') setMode('wave', 1300);
  };

  const stepTip = (dir: 1 | -1) => {
    eng.current.lastInput = performance.now();
    deliverTip(tipCursor.current + dir);
  };

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => hiddenStore.set(false)}
        aria-label={t('show')}
        title={t('show')}
        className="fixed right-4 bottom-4 z-40 grid size-11 place-items-center rounded-[4px] border-2 border-keyline bg-warning text-warning-foreground shadow-md transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <HardHat className="size-5" />
      </button>
    );
  }

  const tip = bubble?.kind === 'tip' ? tips[bubble.index % Math.max(1, tips.length)] : null;
  const roundItem = round?.active ? round.items[round.index] : null;
  const roundFinished = !!round && !round.active && round.index >= round.items.length;
  const canStart = items.length > 0 && !round?.active && !roundFinished;
  const tone: TipTone =
    bubble?.kind === 'tip' && tip
      ? tip.tone
      : bubble?.kind === 'say'
        ? (bubble.tone ?? 'info')
        : bubble?.kind === 'round' && roundItem
          ? roundItem.severity
          : bubble?.kind === 'mail'
            ? 'todo'
            : 'info';
  const card =
    !!bubble &&
    (bubble.kind === 'tip' ? !!tip : bubble.kind === 'say' || bubble.kind === 'mail' || (bubble.kind === 'round' && !!roundItem));

  const roundCta =
    round && !round.active && !roundFinished ? (
      <button type="button" onClick={resumeRound} className={cn(btn, 'bg-warning text-warning-foreground hover:bg-warning/85')}>
        <ClipboardList className="size-3.5" /> {t('roundResume', { index: round.index + 1, total: round.items.length })}
      </button>
    ) : canStart ? (
      <button type="button" onClick={startRound} className={cn(btn, 'bg-warning text-warning-foreground hover:bg-warning/85')}>
        <ClipboardList className="size-3.5" /> {t('roundStart', { count: items.length })}
      </button>
    ) : null;

  return (
    <div
      ref={zoneRef}
      className="pointer-events-none fixed right-3 bottom-2 z-40 h-[300px] w-[min(360px,calc(100vw-1.5rem))] select-none sm:right-6"
    >
      {/* speech / thought bubble — follows Gus along the tape */}
      <div
        ref={bubbleRef}
        role="status"
        aria-live="polite"
        className={cn('absolute bottom-[140px] left-0 w-[min(300px,100%)]', bubble ? 'pointer-events-auto' : 'pointer-events-none')}
        onMouseEnter={() => (bubbleHeld.current = true)}
        onMouseLeave={() => (bubbleHeld.current = false)}
        onFocus={() => (bubbleHeld.current = true)}
        onBlur={() => (bubbleHeld.current = false)}
      >
        {card ? (
          <div
            key={bubble?.kind === 'round' ? `round-${round?.index}` : bubble?.kind}
            className="mascot-pop relative rounded-[4px] border-2 border-keyline bg-card p-3 pr-8 text-[13px] leading-snug text-card-foreground shadow-[0_10px_24px_-14px_hsl(var(--shadow-color)/0.6)]"
          >
            <button
              type="button"
              onClick={bubble?.kind === 'mail' ? closeMail : closeBubble}
              aria-label={t('close')}
              className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-[3px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-3.5" />
            </button>
            <p className="plate-label mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span aria-hidden className={cn('size-2 rounded-[1px]', TONE_DOT[tone])} />
              {bubble?.kind === 'round' && round
                ? t('roundTitle', { index: round.index + 1, total: round.items.length })
                : bubble?.kind === 'mail'
                  ? t('mailTitle')
                  : `${t('name')} · ${t('role')}`}
            </p>

            {bubble?.kind === 'tip' && tip && (
              <>
                <p className="text-pretty">{tip.text}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1">
                  {tip.href && (
                    <Link href={tip.href} className={cn(btn, 'bg-foreground text-background hover:bg-foreground/85')}>
                      {t('open')} <ArrowRight className="size-3.5" />
                    </Link>
                  )}
                  {tips.length > 1 && (
                    <span className="ml-auto flex items-center">
                      <span className="mr-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {t('tipCounter', { index: bubble.index + 1, total: tips.length })}
                      </span>
                      <button type="button" onClick={() => stepTip(-1)} aria-label={t('prev')} className="grid size-7 place-items-center rounded-[3px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                        <ChevronLeft className="size-4" />
                      </button>
                      <button type="button" onClick={() => stepTip(1)} aria-label={t('next')} className="grid size-7 place-items-center rounded-[3px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                        <ChevronRight className="size-4" />
                      </button>
                    </span>
                  )}
                </div>
                {roundCta && <div className="mt-2">{roundCta}</div>}
              </>
            )}

            {bubble?.kind === 'say' && (
              <>
                <p className="text-pretty">{bubble.text}</p>
                {(bubble.href || roundCta) && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {bubble.href && (
                      <Link href={bubble.href} className={cn(btn, 'bg-foreground text-background hover:bg-foreground/85')}>
                        {t('open')} <ArrowRight className="size-3.5" />
                      </Link>
                    )}
                    {roundCta}
                  </div>
                )}
              </>
            )}

            {bubble?.kind === 'round' && roundItem && round && (
              <>
                <p className="font-semibold text-pretty">{roundItem.title}</p>
                {roundItem.detail && <p className="text-muted-foreground">{roundItem.detail}</p>}
                {/* progress pips: one square per stop */}
                <div aria-hidden className="mt-2 flex gap-1">
                  {round.items.map((it, i) => (
                    <span
                      key={it.id}
                      className={cn(
                        'h-1.5 flex-1 rounded-[1px]',
                        round.done.includes(it.id)
                          ? 'bg-success'
                          : round.skipped.includes(it.id)
                            ? 'bg-muted-foreground/40'
                            : i === round.index
                              ? 'bg-warning'
                              : 'bg-muted',
                      )}
                    />
                  ))}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => advanceRound('done')} className={cn(btn, 'bg-success text-success-foreground hover:bg-success/90')}>
                    <Check className="size-3.5" /> {t('roundDoneBtn')}
                  </button>
                  <button type="button" onClick={() => advanceRound('skipped')} className={cn(btn, 'border border-border hover:bg-muted')}>
                    <SkipForward className="size-3.5" /> {t('roundSkip')}
                  </button>
                  <button type="button" onClick={pauseRound} className={cn(btn, 'ml-auto text-muted-foreground hover:bg-muted hover:text-foreground')}>
                    <Pause className="size-3.5" /> {t('roundStop')}
                  </button>
                </div>
              </>
            )}

            {bubble?.kind === 'mail' && (
              <>
                <p className="font-semibold text-pretty">{bubble.n.title}</p>
                {bubble.n.body && <p className="line-clamp-3 text-muted-foreground">{bubble.n.body}</p>}
                <div className="mt-2.5 flex items-center gap-1.5">
                  {bubble.n.link && (
                    <button
                      type="button"
                      onClick={() => {
                        const { id, link } = bubble.n;
                        markRead.mutate(id);
                        if (link) router.push(link);
                        closeMail();
                      }}
                      className={cn(btn, 'bg-foreground text-background hover:bg-foreground/85')}
                    >
                      {t('mailOpen')} <ArrowRight className="size-3.5" />
                    </button>
                  )}
                  <button type="button" onClick={closeMail} className={cn(btn, 'border border-border hover:bg-muted')}>
                    {t('mailLater')}
                  </button>
                </div>
              </>
            )}

            {bubble?.kind !== 'round' && (
              <button
                type="button"
                onClick={() => {
                  closeBubble();
                  hiddenStore.set(true);
                }}
                className="mt-2 block text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                {t('hide')}
              </button>
            )}
            {/* pixel tail */}
            <span ref={tailRef} aria-hidden className="absolute top-full left-1/2 -mt-[2px] block">
              <span className="block h-[6px] w-[12px] border-x-2 border-keyline bg-card" />
              <span className="ml-[2px] block h-[4px] w-[8px] border-x-2 border-b-2 border-keyline bg-card" />
            </span>
          </div>
        ) : bubble?.kind === 'thought' ? (
          <div aria-hidden className="flex flex-col items-center gap-1">
            <span className="mascot-dots flex gap-1.5 rounded-[4px] border-2 border-keyline bg-card px-3 py-2">
              <i className="block size-2 bg-foreground" />
              <i className="block size-2 bg-foreground" />
              <i className="block size-2 bg-foreground" />
            </span>
            <span className="ml-6 block size-2.5 border-2 border-keyline bg-card" />
            <span className="ml-10 block size-1.5 bg-keyline" />
          </div>
        ) : bubble?.kind === 'zzz' ? (
          <div aria-hidden className="mascot-zzz plate-label flex justify-center gap-1 text-xl font-black text-foreground/70">
            <span>z</span>
            <span className="text-2xl">z</span>
            <span className="text-3xl">Z</span>
          </div>
        ) : null}
      </div>

      {/* the patrol range, marked like a factory floor; the round's progress rides on the left post */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 flex items-end">
        <span className="h-3.5 w-1 bg-keyline" />
        <span className="floor-tape h-[7px] flex-1 opacity-90" />
        <span className="h-3.5 w-1 bg-keyline" />
      </div>
      {round?.active && (
        <button
          type="button"
          onClick={() => say({ kind: 'round' })}
          className="plate-label pointer-events-auto absolute bottom-4 left-0 rounded-[3px] border-2 border-keyline bg-warning px-1.5 py-0.5 text-[11px] text-warning-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t('roundPlate', { index: round.index + 1, total: round.items.length })}
        </button>
      )}
      <span ref={shadowRef} aria-hidden className="absolute bottom-[5px] left-0 h-[7px] w-[56px] origin-center rounded-[50%] bg-black/40" />

      <button
        ref={spriteRef}
        type="button"
        aria-label={t('label')}
        title={t('jobs')}
        onClick={onActivate}
        onPointerEnter={(ev) => onHover(true, ev.clientX)}
        onPointerLeave={() => onHover(false)}
        className="pointer-events-auto absolute bottom-[7px] left-0 cursor-pointer rounded-[4px] outline-none will-change-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        style={{ width: W, height: H }}
      >
        <canvas ref={canvasRef} width={SPRITE_W} height={SPRITE_H} className="block size-full [image-rendering:pixelated]" />
      </button>
    </div>
  );
}
