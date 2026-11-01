'use client';

import { ArrowRight, ChevronLeft, ChevronRight, HardHat, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { paintFrame, SPRITE_H, SPRITE_W, type Pose } from './sprite';

export type TipTone = 'alert' | 'warn' | 'todo' | 'info' | 'ok';

export interface MascotTip {
  id: string;
  text: string;
  tone: TipTone;
  href?: string;
}

type Mode = 'idle' | 'walk' | 'jump' | 'laugh' | 'wave' | 'think' | 'talk' | 'sleep' | 'surprised' | 'celebrate';

type Bubble =
  | { kind: 'tip'; index: number }
  | { kind: 'say'; text: string; tone?: TipTone }
  | { kind: 'thought' }
  | { kind: 'zzz' }
  | null;

const SCALE = 4;
const W = SPRITE_W * SCALE; // 64
const H = SPRITE_H * SCALE; // 96
const SPEED = 34; // px / s
const SLEEP_AFTER = 70_000;
const BUBBLE_TTL = 11_000;

const HIDDEN_KEY = 'astro.mascot.hidden';
const hiddenListeners = new Set<() => void>();
function readHidden() {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}
function writeHidden(v: boolean) {
  try {
    localStorage.setItem(HIDDEN_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable: the toggle still works for this page view */
  }
  hiddenListeners.forEach((l) => l());
}
const subscribeHidden = (l: () => void) => {
  hiddenListeners.add(l);
  return () => hiddenListeners.delete(l);
};

const motionQuery = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (l: () => void) => {
  const mq = window.matchMedia(motionQuery);
  mq.addEventListener('change', l);
  return () => mq.removeEventListener('change', l);
};

const TONE_RING: Record<TipTone, string> = {
  alert: 'bg-destructive',
  warn: 'bg-warning',
  todo: 'bg-primary',
  info: 'bg-foreground/70',
  ok: 'bg-success',
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Engine {
  x: number;
  y: number;
  vx: number;
  facing: 1 | -1;
  target: number;
  mode: Mode;
  t: number; // ms in current mode
  until: number; // ms the current mode lasts
  blink: number; // ms until next blink
  blinking: number; // ms left in blink
  shake: number;
  lastInput: number;
  hovered: boolean;
  next: Mode | null; // mode queued after the current one
  onDone: (() => void) | null;
}

/**
 * Gus — a pixel-art shop foreman who patrols a strip of floor tape in the lower-right corner of the
 * dashboard and reports what needs attention (the same live data as the attention board).
 * Click: jump + next tip. Triple-click: laugh. Hover: waves. Idle for a while: dozes off.
 */
export function WorkshopMascot({ tips, greeting }: { tips: MascotTip[]; greeting: string }) {
  const t = useTranslations('mascot');
  const hidden = useSyncExternalStore(subscribeHidden, readHidden, () => true);
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);

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
  const bubbleKind = bubble?.kind ?? null;

  const eng = useRef<Engine>({
    x: 0,
    y: 0,
    vx: 0,
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
    next: null,
    onDone: null,
  });

  const tipsRef = useRef(tips);
  const quips = t.raw('quips') as string[];
  const quipsRef = useRef(quips);
  useEffect(() => {
    tipsRef.current = tips;
    quipsRef.current = quips;
  }, [tips, quips]);
  const nextQuip = () => {
    const list = quipsRef.current;
    return list[quipCursor.current++ % list.length];
  };

  // ---------------------------------------------------------------- bubble helpers
  const clearBubbleTimer = () => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = null;
  };
  const armBubbleTimer = useCallback(() => {
    clearBubbleTimer();
    // a bubble the pointer or keyboard is on stays open; check again shortly
    const expire = () => {
      if (bubbleHeld.current) {
        bubbleTimer.current = setTimeout(expire, 2000);
        return;
      }
      setBubble((b) => (b && (b.kind === 'tip' || b.kind === 'say') ? null : b));
    };
    bubbleTimer.current = setTimeout(expire, BUBBLE_TTL);
  }, []);

  const say = useCallback(
    (b: Exclude<Bubble, null>) => {
      setBubble(b);
      if (b.kind === 'tip' || b.kind === 'say') armBubbleTimer();
      else clearBubbleTimer();
    },
    [armBubbleTimer],
  );

  const setMode = useCallback((mode: Mode, until: number, onDone: (() => void) | null = null) => {
    const e = eng.current;
    e.mode = mode;
    e.t = 0;
    e.until = until;
    e.onDone = onDone;
  }, []);

  /** speak a tip with a reaction that matches its tone */
  const deliverTip = useCallback(
    (index: number) => {
      const list = tipsRef.current;
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

  const thinkThenTip = useCallback(
    (index: number) => {
      say({ kind: 'thought' });
      setMode('think', 2100, () => deliverTip(index));
    },
    [deliverTip, say, setMode],
  );

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

    let raf = 0;
    let last = performance.now();
    let autoTimer = 0; // ms until the next unprompted tip
    let started = false;

    const pose = (): Pose => {
      const p: Pose = { eyes: 'open', mouth: 'smile', arms: 'down', legs: 'stand', look: 0 };
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
          break;
        case 'celebrate': {
          const hop = Math.floor(k / 325) % 2;
          p.eyes = 'happy';
          p.mouth = 'open';
          p.cheeks = true;
          p.arms = 'up';
          p.legs = hop ? 'tuck' : 'stand';
          break;
        }
        case 'wave':
          p.arms = Math.floor(k / 220) % 2 ? 'wave2' : 'wave1';
          p.mouth = 'smile';
          p.cheeks = true;
          break;
        case 'think':
          p.eyes = 'up';
          p.mouth = Math.floor(k / 700) % 2 ? 'flat' : 'o';
          p.arms = 'think';
          p.look = -1;
          break;
        case 'talk':
          p.mouth = Math.floor(k / 130) % 2 ? 'open' : 'neutral';
          p.arms = k < 700 ? 'wave1' : 'down';
          break;
        case 'sleep':
          p.eyes = 'closed';
          p.mouth = Math.floor(k / 1400) % 2 ? 'o' : 'neutral';
          p.legs = 'crouch';
          break;
        case 'idle':
          p.mouth = 'smile';
          break;
      }
      if (e.blinking > 0 && p.eyes === 'open') p.eyes = 'closed';
      return p;
    };

    let lastPoseKey = '';
    const draw = () => {
      const p = pose();
      const key = `${p.eyes}${p.mouth}${p.arms}${p.legs}${p.look}${p.cheeks}${e.facing}`;
      if (key !== lastPoseKey) {
        paintFrame(ctx, p, e.facing);
        lastPoseKey = key;
      }
      const sx = Math.round(e.x + e.shake);
      const sy = Math.round(e.y);
      if (spriteRef.current) spriteRef.current.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
      if (shadowRef.current) {
        const lift = Math.min(1, -e.y / 40);
        shadowRef.current.style.transform = `translate3d(${sx + 10}px, 0, 0) scaleX(${1 - lift * 0.45})`;
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
        // the callback may have started a new mode
        if (e.t === 0 && e.mode !== 'idle') return;
      }
      if (e.mode !== 'sleep') setMode('idle', rand(1400, 3800));
    };

    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      e.t += dt;

      // blink
      if (e.blinking > 0) e.blinking -= dt;
      else if ((e.blink -= dt) <= 0) {
        e.blinking = 130;
        e.blink = rand(2200, 5600);
      }

      if (!started && e.t > 900) {
        started = true;
        say({ kind: 'say', text: greeting });
        setMode('wave', 1500);
        autoTimer = rand(9000, 13000);
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
            const h = e.mode === 'jump' ? 34 : 18;
            e.y = r > 0.14 && r < 0.88 ? -Math.sin(((r - 0.14) / 0.74) * Math.PI) * h : 0;
            break;
          }
          case 'celebrate': {
            const ph = (e.t % 650) / 650;
            e.y = ph > 0.5 ? -Math.sin(((ph - 0.5) / 0.5) * Math.PI) * 14 : 0;
            break;
          }
          case 'laugh':
            e.shake = Math.floor(e.t / 70) % 2 ? SCALE / 2 : -SCALE / 2;
            break;
          default:
            break;
        }
      }

      if (e.mode !== 'walk' && e.mode !== 'sleep' && e.mode !== 'idle' && e.t >= e.until) finish();

      if (e.mode === 'idle' && !e.hovered && e.t >= e.until) {
        const idleFor = now - e.lastInput;
        if (idleFor > SLEEP_AFTER && !bubbleHeld.current) {
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

      // unprompted check-ins: think, then report the most useful thing
      if (started && e.mode !== 'sleep' && !e.hovered) {
        autoTimer -= dt;
        if (autoTimer <= 0) {
          autoTimer = rand(26000, 38000);
          if (!bubbleHeld.current && (e.mode === 'idle' || e.mode === 'walk')) {
            if (tipsRef.current.length) thinkThenTip(tipCursor.current + 1);
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
  }, [hidden, reduced, greeting, say, setMode, thinkThenTip]);

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
    const nextIndex = tipCursor.current + 1;
    if (!tipsRef.current.length) {
      say({ kind: 'say', text: nextQuip() });
      setMode('jump', 650);
      return;
    }
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

  const step = (dir: 1 | -1) => {
    eng.current.lastInput = performance.now();
    deliverTip(tipCursor.current + dir);
  };

  const closeBubble = () => {
    clearBubbleTimer();
    setBubble(null);
  };

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => writeHidden(false)}
        aria-label={t('show')}
        title={t('show')}
        className="fixed right-4 bottom-4 z-40 grid size-11 place-items-center rounded-[4px] border-2 border-keyline bg-warning text-warning-foreground shadow-md transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <HardHat className="size-5" />
      </button>
    );
  }

  const tip = bubble?.kind === 'tip' ? tips[bubble.index % Math.max(1, tips.length)] : null;

  return (
    <div
      ref={zoneRef}
      className="pointer-events-none fixed right-3 bottom-2 z-40 h-[230px] w-[min(340px,calc(100vw-1.5rem))] select-none sm:right-6"
    >
      {/* speech / thought bubble — follows Gus along the tape */}
      <div
        ref={bubbleRef}
        role="status"
        aria-live="polite"
        className={cn(
          'absolute bottom-[112px] left-0 w-[min(280px,100%)]',
          bubbleKind ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        onMouseEnter={() => (bubbleHeld.current = true)}
        onMouseLeave={() => (bubbleHeld.current = false)}
        onFocus={() => (bubbleHeld.current = true)}
        onBlur={() => (bubbleHeld.current = false)}
      >
        {(bubble?.kind === 'tip' && tip) || bubble?.kind === 'say' ? (
          <div className="mascot-pop relative rounded-[4px] border-2 border-keyline bg-card p-3 pr-8 text-[13px] leading-snug text-card-foreground shadow-[0_10px_24px_-14px_hsl(var(--shadow-color)/0.6)]">
            <button
              type="button"
              onClick={closeBubble}
              aria-label={t('close')}
              className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-[3px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-3.5" />
            </button>
            <p className="plate-label mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span aria-hidden className={cn('size-2 rounded-[1px]', TONE_RING[tip?.tone ?? (bubble.kind === 'say' ? bubble.tone ?? 'info' : 'info')])} />
              {t('name')} · {t('role')}
            </p>
            <p className="text-pretty">{tip ? tip.text : bubble.kind === 'say' ? bubble.text : null}</p>
            {tip && (
              <div className="mt-2.5 flex items-center gap-1">
                {tip.href && (
                  <Link
                    href={tip.href}
                    className="mr-auto inline-flex h-7 items-center gap-1 rounded-[3px] bg-foreground px-2.5 text-xs font-semibold text-background hover:bg-foreground/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {t('open')} <ArrowRight className="size-3.5" />
                  </Link>
                )}
                {tips.length > 1 && (
                  <>
                    <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                      {t('tipCounter', { index: (bubble?.kind === 'tip' ? bubble.index : 0) + 1, total: tips.length })}
                    </span>
                    <button
                      type="button"
                      onClick={() => step(-1)}
                      aria-label={t('prev')}
                      className="grid size-7 place-items-center rounded-[3px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => step(1)}
                      aria-label={t('next')}
                      className="grid size-7 place-items-center rounded-[3px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                closeBubble();
                writeHidden(true);
              }}
              className="mt-2 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {t('hide')}
            </button>
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
          <div aria-hidden className="mascot-zzz plate-label flex justify-center gap-1 text-lg font-black text-foreground/70">
            <span>z</span>
            <span className="text-xl">z</span>
            <span className="text-2xl">Z</span>
          </div>
        ) : null}
      </div>

      {/* the patrol range, marked like a factory floor */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 flex items-end">
        <span className="h-3 w-1 bg-keyline" />
        <span className="floor-tape h-[6px] flex-1 opacity-90" />
        <span className="h-3 w-1 bg-keyline" />
      </div>
      <span
        ref={shadowRef}
        aria-hidden
        className="absolute bottom-[4px] left-0 h-[6px] w-[44px] origin-center rounded-[50%] bg-black/40"
      />

      <button
        ref={spriteRef}
        type="button"
        aria-label={t('label')}
        onClick={onActivate}
        onPointerEnter={(ev) => onHover(true, ev.clientX)}
        onPointerLeave={() => onHover(false)}
        className="pointer-events-auto absolute bottom-[6px] left-0 cursor-pointer rounded-[4px] outline-none will-change-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        style={{ width: W, height: H }}
      >
        <canvas
          ref={canvasRef}
          width={SPRITE_W}
          height={SPRITE_H}
          className="block size-full [image-rendering:pixelated]"
        />
      </button>
    </div>
  );
}
