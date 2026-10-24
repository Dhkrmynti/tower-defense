import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  Box,
  Check,
  Copy,
  Crosshair,
  FastForward,
  FlaskConical,
  Lock,
  Map as MapIcon,
  Music,
  Pause,
  Play,
  ScrollText,
  Shield,
  Skull,
  Smartphone,
  Star,
  Swords,
  Trophy,
  Volume2,
  VolumeX,
  Wallet,
  X as Close,
  Zap,
} from 'lucide-react';
import { useFlywheelEngine } from '../hooks/useBurnEngine';
import { useDefenders } from '../hooks/useDefenders';
import { useSplit } from '../components/engine/split';
import { PONS_V2_CONFIG } from '../contracts';
import { sounds } from '../utils/audio';
import { BastionMark } from '../components/bastion/BastionMark';
import { Leaderboard } from '../components/bastion/Leaderboard';
import { Milestones } from '../components/bastion/Milestones';
import { Rounds } from '../components/bastion/Rounds';
import { CommandCenter } from '../components/bastion/CommandCenter';
import { BurnLedgerDrawer } from '../components/BurnLedgerDrawer';
import { EXPLORER_URL, MANUAL, TAGLINE, X_HANDLE, X_URL, buyUrl, chartUrl, fortressStage, isLiveCA } from '../components/bastion/lore';
import { Sim, type Banner, type WorldInput } from './sim';
import { render, type Targeting, type View } from './render';
import type { Scene3D } from './render3d';
import { sfx } from './sfx';
import { MAPS } from './maps';
import { loadViewMode, makeProj, project, saveViewMode, unproject, type ViewMode } from './iso';
import { MISSIONS, loadCampaign, missionUnlocked, survivalMaps, type Mission } from './campaign';
import { ABILITIES, ABILITY_ORDER, ENEMIES, HOLDER_TIERS, RESEARCH, TURRETS, TURRET_ORDER, perksFor, upgradeCost, type AbilityKind, type Perks, type ResearchId, type TurretKind } from './world';
const MemexAdmin = lazy(() => import('../components/MemexAdmin').then((m) => ({ default: m.MemexAdmin })));

type Modal = null | 'leaderboard' | 'milestones' | 'rounds' | 'command' | 'manual' | 'research' | 'campaign' | 'survival';

const XIcon = ({ className }: { className?: string }) => (
  <svg className={`fill-current ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18.9 2H22l-6.8 7.8L23.2 22H17l-4.9-6.4L6.5 22H3.4l7.2-8.2L2.9 2h6.4l4.4 5.8L18.9 2Zm-1.1 17.8h1.7L8.3 4.1H6.5l11.3 15.7Z" />
  </svg>
);
const fmt = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.floor(n));

/** The game: the whole screen is the arena, the HUD floats over it, the engine is the world. */
export function Game({ memex, onLeaveMemex }: { memex: boolean; onLeaveMemex: () => void }) {
  const { state, config, setConfig, logs, burnLedger } = useFlywheelEngine();
  const split = useSplit();
  const { board, loading: boardLoading, error: boardError } = useDefenders(config, config.creatorAddress);

  const live = isLiveCA(config.tokenAddress);
  const ca = live ? config.tokenAddress : '';
  const tokenSymbol = `$${config.tokenSymbol || 'BASTION'}`;
  const deadAddress = config.deadAddress || PONS_V2_CONFIG.contracts.deadAddress;
  const threshold = state.currentThresholdETH || state.claimThresholdETH || config.claimThresholdETH || 0;
  const escrow = (state.currentEscrowBalanceETH || 0) + (live ? split.pendingFeesETH : 0);
  const fill = threshold > 0 ? Math.max(0, Math.min(1, escrow / threshold)) : 0;
  const totalBurned = !live ? 0 : state.totalTokensBurned > 0 ? state.totalTokensBurned : burnLedger.reduce((a, c) => a + (c.burnedJollyburn || c.burnedMuseburn || c.burnedIncinerator || 0), 0);
  const chainPct = !live ? 0 : state.burnedPercentageOfSupply > 0 ? state.burnedPercentageOfSupply : state.totalSupply > 0 ? (totalBurned / state.totalSupply) * 100 : 0;
  // ?purged=N previews the fortress and the unlocks at a given purged percentage (dev only)
  const localHost = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  const debugPct = localHost ? Number(new URLSearchParams(window.location.search).get('purged')) || 0 : 0;
  const burnedPct = debugPct > 0 ? debugPct : chainPct;
  const round = (live ? state.cycleCount : 0) + 1;
  const stage = fortressStage(burnedPct);

  const input = useMemo<WorldInput>(() => ({ fill, burnedPct, phase: state.currentPhase, active: state.isWheelSpinning, live }), [fill, burnedPct, state.currentPhase, state.isWheelSpinning, live]);
  const inputRef = useRef(input);
  useLayoutEffect(() => {
    inputRef.current = input;
  }, [input]);

  /* ───────── the sim and the canvas ───────── */
  const simRef = useRef<Sim>(null!);
  if (!simRef.current) simRef.current = new Sim();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewModeState] = useState<ViewMode>(() => loadViewMode());
  const viewModeRef = useRef<ViewMode>(viewMode);
  useLayoutEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);
  const viewRef = useRef<View>({ scale: 1, ox: 0, oy: 0, proj: makeProj(loadViewMode()) });
  const glRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const downRef = useRef({ x: 0, y: 0, moved: false, slop: 6 });
  const sizeRef = useRef({ cw: 0, ch: 0, dpr: 1, left: 0, top: 0 });
  const hoverRef = useRef<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  const targetRef = useRef<Targeting | null>(null);
  const cursorRef = useRef({ x: 0, y: 0 });

  const [hud, setHud] = useState(() => snapshot(simRef.current, 0));
  const [selected, setSelected] = useState<number | null>(null);
  const [buildKind, setBuildKind] = useState<TurretKind>('sentry');
  const [targeting, setTargeting] = useState<AbilityKind | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [copiedCA, setCopiedCA] = useState(false);
  const [copiedDead, setCopiedDead] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);
  const [musicOn, setMusicOn] = useState(true);
  const [portrait, setPortrait] = useState(false);
  const [portraitOk, setPortraitOk] = useState(false);
  const [perks, setPerks] = useState<Perks | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [campaign, setCampaign] = useState(() => loadCampaign());
  const bannerTimer = useRef(0);
  const [sceneReady, setSceneReady] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const wasPausedRef = useRef(false);
  useLayoutEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const setViewMode = (m: ViewMode) => {
    setViewModeState(m);
    saveViewMode(m);
    viewRef.current = { ...viewRef.current, proj: makeProj(m) };
    window.dispatchEvent(new Event('resize'));
    sfx.play('click');
  };
  const cycleView = () => setViewMode(viewMode === 'three' ? 'iso' : viewMode === 'iso' ? 'top' : 'three');

  // the 3D scene lives only while the 3D view is on; three.js loads on demand
  useEffect(() => {
    if (viewMode !== 'three' || memex) return;
    let alive = true;
    let scene: Scene3D | null = null;
    const canvas = glRef.current;
    const lowEnd = (navigator.hardwareConcurrency || 8) < 6 || /Android|iPhone|iPad/i.test(navigator.userAgent);
    import('./render3d')
      .then(({ Scene3D: Ctor }) => {
        if (!alive || !canvas || !hostRef.current) return;
        scene = new Ctor(canvas, { lowEnd });
        const rect = hostRef.current.getBoundingClientRect();
        scene.setSize(rect.width, rect.height, window.devicePixelRatio || 1);
        sceneRef.current = scene;
        setSceneReady(true);
      })
      .catch((e) => {
        console.error('[bastion] 3D view failed, falling back to the isometric view', e);
        if (alive) setViewMode('iso');
      });
    // a lost WebGL context (phones backgrounding the tab) drops to 2D; the next toggle rebuilds
    const onLost = (e: Event) => {
      e.preventDefault();
      console.warn('[bastion] WebGL context lost');
      if (alive) setViewMode('iso');
    };
    canvas?.addEventListener('webglcontextlost', onLost);
    return () => {
      alive = false;
      canvas?.removeEventListener('webglcontextlost', onLost);
      sceneRef.current = null;
      setSceneReady(false);
      scene?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, memex]);

  useEffect(() => {
    sounds.enabled = config.soundEnabled;
    sfx.enabled = config.soundEnabled;
    if (!config.soundEnabled) sfx.stopMusic();
    else if (musicOn && simRef.current.s.status !== 'title') sfx.startMusic();
  }, [config.soundEnabled, musicOn]);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const check = () => setPortrait(mq.matches && window.innerWidth < 860);
    check();
    mq.addEventListener('change', check);
    window.addEventListener('resize', check);
    return () => {
      mq.removeEventListener('change', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  // a modal pauses the field; closing it resumes
  useEffect(() => {
    const sim = simRef.current;
    if (!sim.playing) return;
    if (modal || logOpen) {
      wasPausedRef.current = sim.s.paused;
      sim.setPaused(true);
    } else if (!wasPausedRef.current) sim.setPaused(false);
  }, [modal, logOpen]);

  const showBanner = useCallback((b: Banner) => {
    setBanner(b);
    window.clearTimeout(bannerTimer.current);
    bannerTimer.current = window.setTimeout(() => setBanner(null), b.kind === 'over' || b.kind === 'won' ? 60_000 : b.kind === 'ground' ? 6000 : 3200);
  }, []);

  const toScreen = useCallback((wx: number, wy: number) => {
    const scene = sceneRef.current;
    if (viewModeRef.current === 'three' && scene) {
      const [x, y] = scene.toScreen(wx, wy);
      return { x, y };
    }
    const v = viewRef.current;
    const { dpr } = sizeRef.current;
    const [X, Y] = project(v.proj, wx, wy);
    return { x: (v.ox + X * v.scale) / dpr, y: (v.oy + Y * v.scale) / dpr };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host || memex) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sim = simRef.current;
    let raf = 0;
    let last = performance.now();
    let hudAt = 0;
    let lastHud = '';
    let lastMap = sim.map;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.max(1, Math.round(rect.width * dpr));
      const ch = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = cw;
      canvas.height = ch;
      const proj = viewRef.current.proj;
      const scale = Math.min(cw / proj.width, ch / proj.height);
      viewRef.current = { scale, ox: (cw - proj.width * scale) / 2, oy: (ch - proj.height * scale) / 2, proj };
      sizeRef.current = { cw, ch, dpr, left: rect.left, top: rect.top };
      sceneRef.current?.setSize(rect.width, rect.height, dpr);
      const slot = selectedRef.current !== null ? sim.map.slots[selectedRef.current] : null;
      if (slot) setPopoverPos(toScreen(slot[0], slot[1]));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    window.addEventListener('resize', resize);
    resize();

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!document.hidden) {
        sim.step(dt, inputRef.current);
        if (sim.map !== lastMap) {
          lastMap = sim.map;
          selectedRef.current = null;
          setSelected(null);
          setPopoverPos(null);
        }
        for (const ev of sim.drain()) {
          if (ev.type === 'banner') showBanner(ev.banner);
          else sfx.play(ev.name);
        }
        const { cw, ch } = sizeRef.current;
        const scene = sceneRef.current;
        if (viewModeRef.current === 'three' && scene) {
          scene.render(sim, inputRef.current, hoverRef.current, selectedRef.current, targetRef.current, dt);
          // the camera moves every frame, so the popover follows its mount through the DOM
          const sel = selectedRef.current;
          const slot = sel !== null ? sim.map.slots[sel] : null;
          const pop = popoverRef.current;
          if (slot && pop) {
            const p = toScreen(slot[0], slot[1]);
            const h = pop.offsetHeight || 200;
            const w = pop.offsetWidth || 248;
            pop.style.left = `${Math.min(Math.max(8, p.x - w / 2), window.innerWidth - w - 8)}px`;
            pop.style.top = `${Math.max(8, Math.min(p.y - h - 18, window.innerHeight - h - 8))}px`;
          }
        } else render(ctx, sim, inputRef.current, viewRef.current, hoverRef.current, selectedRef.current, cw, ch, targetRef.current);
        if (now - hudAt > 120) {
          hudAt = now;
          const next = snapshot(sim, inputRef.current.burnedPct);
          const key = JSON.stringify(next);
          if (key !== lastHud) {
            lastHud = key;
            setHud(next);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [memex, showBanner, toScreen]);

  /* ───────── pointer ───────── */
  const toWorld = (e: React.PointerEvent | React.MouseEvent) => {
    const { dpr, left, top } = sizeRef.current;
    const scene = sceneRef.current;
    if (viewModeRef.current === 'three' && scene) {
      const hit = scene.pick(e.clientX - left, e.clientY - top);
      return hit ? { x: hit[0], y: hit[1] } : { x: -9999, y: -9999 };
    }
    const v = viewRef.current;
    const [x, y] = unproject(v.proj, ((e.clientX - left) * dpr - v.ox) / v.scale, ((e.clientY - top) * dpr - v.oy) / v.scale);
    return { x, y };
  };
  const slotAt = (x: number, y: number) => {
    let best: number | null = null;
    let bd = 30;
    simRef.current.map.slots.forEach(([sx, sy], i) => {
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  const onMove = (e: React.PointerEvent) => {
    const { x, y } = toWorld(e);
    cursorRef.current = { x, y };
    hoverRef.current = targeting ? null : slotAt(x, y);
    if (targeting) targetRef.current = { kind: targeting, x, y };
  };
  const selectSlot = (i: number | null) => {
    const slot = i === null ? null : simRef.current.map.slots[i];
    if (i === null || !slot) {
      setSelected(null);
      setPopoverPos(null);
      return;
    }
    setSelected(i);
    setPopoverPos(toScreen(slot[0], slot[1]));
  };
  const armAbility = (kind: AbilityKind | null) => {
    const sim = simRef.current;
    if (kind && !sim.abilityReady(kind)) return;
    if (kind && !ABILITIES[kind].targeted) {
      sim.useAbility(kind);
      return;
    }
    setTargeting(kind);
    targetRef.current = kind ? { kind, x: cursorRef.current.x, y: cursorRef.current.y } : null;
    if (kind) selectSlot(null);
  };
  const onDown = (e: React.PointerEvent) => {
    downRef.current = { x: e.clientX, y: e.clientY, moved: false, slop: e.pointerType === 'touch' ? 16 : 6 };
  };
  const onClick = (e: React.MouseEvent) => {
    const sim = simRef.current;
    sfx.unlock();
    // in 3D a drag orbits the camera; only a still click reaches the field
    if (Math.hypot(e.clientX - downRef.current.x, e.clientY - downRef.current.y) > downRef.current.slop) return;
    if (!sim.playing || sim.s.paused) return;
    const { x, y } = toWorld(e);
    if (targeting) {
      if (sim.useAbility(targeting, x, y)) armAbility(null);
      return;
    }
    const slot = slotAt(x, y);
    if (slot !== null) {
      const occupied = sim.s.turrets.some((t) => t.slot === slot);
      if (!occupied && sim.canBuild(buildKind, inputRef.current) && selected !== slot) {
        sim.build(slot, buildKind, inputRef.current);
        selectSlot(null);
        return;
      }
      selectSlot(slot);
      return;
    }
    selectSlot(null);
    sim.strike(x, y);
  };

  const startSurvival = (mapOrder?: number[]) => {
    sfx.unlock();
    simRef.current.start(perks, { mode: 'survival', mapOrder: mapOrder ?? survivalMaps(campaign) });
    selectSlot(null);
    setModal(null);
    if (musicOn && config.soundEnabled) sfx.startMusic();
  };
  const startMission = (m: Mission) => {
    sfx.unlock();
    simRef.current.start(perks, { mode: 'campaign', mission: m });
    selectSlot(null);
    setModal(null);
    if (musicOn && config.soundEnabled) sfx.startMusic();
  };
  const restart = () => {
    const sim = simRef.current;
    if (sim.mode === 'campaign' && sim.mission) startMission(sim.mission);
    else startSurvival(sim.mapOrder);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const sim = simRef.current;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (targeting) armAbility(null);
        else if (modal) setModal(null);
        else if (logOpen) setLogOpen(false);
        else selectSlot(null);
        return;
      }
      if (modal || logOpen || (portrait && !portraitOk)) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (sim.s.status === 'title') setModal('campaign');
        else if (sim.s.status === 'over' || sim.s.status === 'won') restart();
        else sim.sendWave();
      } else if (k === 'p') sim.togglePause();
      else if (k === 'f') sim.setSpeed(sim.s.speed === 1 ? 2 : 1);
      else if (k === 'q') armAbility('airstrike');
      else if (k === 'w') armAbility('barricade');
      else if (k === 'e') armAbility('drone');
      else if (k === 'r') armAbility('overcharge');
      else if (k === 't' && sim.playing) setModal(modal === 'research' ? null : 'research');
      else if (/^[1-5]$/.test(e.key)) {
        const kind = TURRET_ORDER[parseInt(e.key, 10) - 1];
        if (sim.unlocked(kind, inputRef.current.burnedPct)) setBuildKind(kind);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, logOpen, musicOn, config.soundEnabled, targeting, perks, campaign, portrait, portraitOk]);

  useEffect(() => {
    if (hud.status === 'won') setCampaign(loadCampaign());
  }, [hud.status]);

  if (memex) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-field" />}>
        <MemexAdmin onBack={onLeaveMemex} />
      </Suspense>
    );
  }

  const sim = simRef.current;
  const copyCA = () => {
    if (!ca) return;
    navigator.clipboard.writeText(ca);
    setCopiedCA(true);
    sfx.play('sell');
    setTimeout(() => setCopiedCA(false), 2500);
  };
  const copyDead = () => {
    navigator.clipboard.writeText(deadAddress);
    setCopiedDead(true);
    setTimeout(() => setCopiedDead(false), 2000);
  };
  const connectWallet = async () => {
    if (!live) return;
    setConnecting(true);
    setWalletError(null);
    try {
      const [{ connectWallet: connect }, { fetchHolding }] = await Promise.all([import('../utils/web3'), import('../utils/holder')]);
      const res = await connect();
      if (!res) {
        setWalletError('No wallet found.');
        return;
      }
      const { balance, heldPct } = await fetchHolding(res.address, config.tokenAddress, config.rpcUrl);
      const rank = board ? board.defenders.findIndex((d) => d.address === res.address.toLowerCase()) + 1 : 0;
      setPerks(perksFor(res.address, balance, heldPct, rank));
      sfx.play('upgrade');
    } catch (e) {
      setWalletError((e as Error).message || 'Could not read the wallet.');
    } finally {
      setConnecting(false);
    }
  };
  const toggleMusic = () => {
    const on = !musicOn;
    setMusicOn(on);
    sfx.setMusic(on && config.soundEnabled && hud.status !== 'title');
  };
  const selectedTurret = selected !== null ? hud.turrets.find((t) => t.slot === selected) ?? null : null;
  const engineLine = !live
    ? 'CA soon · the field runs on practice ammo'
    : !split.inSync
      ? 'Reconnecting to Robinhood Chain…'
      : state.isWheelSpinning
        ? `Round ${round} running on chain: ${state.currentPhase}`
        : fill >= 0.999
          ? 'War chest full · the Warden is opening it'
          : `Round ${round} arming · every trade charges the chest`;
  const hpPct = (hud.hp / hud.maxHp) * 100;
  const playing = hud.status === 'build' || hud.status === 'wave';
  const nextMission = hud.mission ? MISSIONS.find((m) => m.id === hud.mission!.id + 1) : null;

  return (
    <div className="relative h-[100svh] w-full overflow-hidden bg-field-deep font-body text-cream select-none">
      {/* while playing the arena sits above the build bar, so no mount hides under it */}
      <div
        ref={hostRef}
        className={`absolute inset-x-0 top-0 touch-none ${playing ? 'bottom-[6.6rem] sm:bottom-[8.4rem] short:bottom-[5.2rem]' : 'bottom-0'}`}
        onPointerMove={onMove}
        onPointerDown={onDown}
        onClick={onClick}
        onPointerLeave={() => (hoverRef.current = null)}
      >
        <canvas ref={canvasRef} className={`block h-full w-full ${targeting ? 'cursor-cell' : 'cursor-crosshair'} ${viewMode === 'three' && sceneReady ? 'hidden' : ''}`} aria-label="The arena" />
        <canvas ref={glRef} className={`block h-full w-full ${targeting ? 'cursor-cell' : 'cursor-crosshair'} ${viewMode === 'three' && sceneReady ? '' : 'hidden'}`} aria-label="The arena in 3D" />
      </div>
      {viewMode === 'three' && !sceneReady ? (
        <p className="pointer-events-none absolute bottom-[9rem] left-1/2 z-20 m-0 -translate-x-1/2 rounded-[4px] border-2 border-steel-line bg-field-deep/90 px-3 py-1.5 hud text-[0.62rem] text-dust" role="status">
          Loading the 3D field…
        </p>
      ) : null}

      {/* ───────── top HUD ───────── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[35] flex items-start justify-between gap-2 p-2 sm:p-4">
        <div className="pointer-events-auto flex flex-col gap-1.5 sm:gap-2">
          <div className="panel flex items-center gap-2 px-2.5 py-1.5 sm:gap-3 sm:px-3 sm:py-2">
            <BastionMark className="h-7 w-7 sm:h-8 sm:w-8" />
            <div>
              <p className="m-0 hud text-[0.5rem] text-dust-dim sm:text-[0.56rem]">
                Round {round} · {stage.name}
                {playing ? ` · ${hud.mapName}` : ''}
                {playing && hud.title ? ` · ${hud.title}` : ''}
              </p>
              <p className="m-0 display text-[0.95rem] leading-none text-cream sm:text-[1.05rem]">
                {hud.status === 'wave'
                  ? `Wave ${hud.wave}${hud.mission ? ` / ${hud.mission.waves}` : ''}`
                  : hud.status === 'build'
                    ? hud.wave === 0
                      ? 'Build phase'
                      : `Wave ${hud.wave} held`
                    : 'Bastion'}
                {hud.paused ? ' · paused' : ''}
              </p>
            </div>
          </div>
          {hud.status !== 'title' ? (
            <div className="panel flex items-center gap-3 px-2.5 py-1.5 sm:gap-4 sm:px-3 sm:py-2">
              <div className="w-24 sm:w-32">
                <div className="flex items-center justify-between hud text-[0.5rem] text-dust-dim sm:text-[0.54rem]">
                  <span>Gate</span>
                  <span className={hpPct < 35 ? 'text-enemy' : 'text-cream'}>
                    {hud.hp} / {hud.maxHp}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-[2px] bg-field-deep ring-1 ring-steel-line sm:h-2.5">
                  <div className={`h-full transition-[width] duration-300 ${hpPct < 35 ? 'bg-enemy' : 'bg-stone'}`} style={{ width: `${hpPct}%` }} />
                </div>
              </div>
              <div>
                <p className="m-0 hud text-[0.5rem] text-dust-dim sm:text-[0.54rem]">Scrap</p>
                <p className="m-0 display text-[1.05rem] leading-none text-brass tabular sm:text-[1.2rem]">{hud.scrap}</p>
              </div>
              <div>
                <p className="m-0 hud text-[0.5rem] text-dust-dim sm:text-[0.54rem]">Kills</p>
                <p className="m-0 display text-[1.05rem] leading-none text-cream tabular sm:text-[1.2rem]">{hud.kills}</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-1.5 sm:gap-2">
          <div className="panel flex items-center gap-2 px-2.5 py-1.5 sm:gap-3 sm:px-3 sm:py-2">
            <div className="hidden text-right sm:block">
              <p className="m-0 hud text-[0.54rem] text-dust-dim">War chest · shield</p>
              <p className="m-0 font-mono text-[0.72rem] text-cream tabular">
                {escrow.toFixed(4)} <span className="text-dust-dim">/ {threshold.toFixed(3)} ETH</span>
              </p>
            </div>
            <div className="relative h-9 w-9 sm:h-10 sm:w-10">
              <svg viewBox="0 0 40 40" className="h-9 w-9 -rotate-90 sm:h-10 sm:w-10">
                <circle cx="20" cy="20" r="16" fill="none" stroke="#1f3129" strokeWidth="5" />
                <circle cx="20" cy="20" r="16" fill="none" stroke={fill >= 0.999 ? '#ffd96a' : '#38e8ff'} strokeWidth="5" strokeDasharray={`${fill * 100.5} 100.5`} />
              </svg>
              <Shield className="absolute inset-0 m-auto h-4 w-4 text-shield" />
            </div>
            <p className="m-0 display text-[1.05rem] leading-none text-shield tabular sm:text-[1.2rem]">{Math.round(fill * 100)}%</p>
          </div>
          <div className={`flex max-w-[64vw] flex-wrap justify-end gap-1 sm:max-w-none sm:gap-1.5 ${hud.status === 'title' ? 'short:hidden' : ''}`}>
            <HudButton onClick={() => setModal('leaderboard')} icon={<Trophy className="h-3.5 w-3.5" />} label="Board" />
            <HudButton onClick={() => setModal('milestones')} icon={<Skull className="h-3.5 w-3.5" />} label={`${burnedPct.toFixed(2)}%`} />
            <HudButton onClick={() => setModal('rounds')} icon={<Zap className="h-3.5 w-3.5" />} label="Rounds" />
            <HudButton onClick={() => setLogOpen(true)} icon={<ScrollText className="h-3.5 w-3.5" />} label="Log" />
            <HudButton onClick={() => setModal('command')} icon={<Crosshair className="h-3.5 w-3.5" />} label="Engine" />
            <button type="button" onClick={cycleView} className={`btn-steel h-8 cursor-pointer gap-1.5 bg-field-deep/80 px-2.5 text-[0.58rem] ${viewMode === 'three' ? 'text-brass' : ''}`} title="3D, isometric or top-down" aria-label="Switch view: 3D, isometric or top-down">
              <Box className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{viewMode === 'three' ? '3D' : viewMode === 'iso' ? 'Iso' : 'Top'}</span>
            </button>
            <button type="button" onClick={toggleMusic} className={`btn-steel h-8 w-8 cursor-pointer bg-field-deep/80 ${musicOn ? 'text-brass' : ''}`} aria-label={musicOn ? 'Music off' : 'Music on'} title="Music">
              <Music className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setConfig({ ...config, soundEnabled: !config.soundEnabled })} className="btn-steel h-8 w-8 cursor-pointer bg-field-deep/80" aria-label={config.soundEnabled ? 'Mute' : 'Sound on'} title="Sound">
              {config.soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            </button>
            {live ? (
              <a href={buyUrl(ca)} target="_blank" rel="noreferrer" className="btn-fire h-8 px-3 text-[0.6rem] no-underline">
                Buy {tokenSymbol}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            ) : (
              <a href={X_URL} target="_blank" rel="noreferrer" className="btn-fire h-8 px-3 text-[0.6rem] no-underline">
                <XIcon className="h-3 w-3" />
                CA soon
              </a>
            )}
          </div>
        </div>
      </div>

      {/* boss bar */}
      {hud.boss ? (
        <div className="pointer-events-none absolute left-1/2 top-[7.5rem] z-20 w-[min(26rem,70vw)] -translate-x-1/2 short:top-[4.8rem] lg:top-4">
          <div className="flex items-center justify-between hud text-[0.58rem] text-enemy [text-shadow:0_2px_0_#070b08]">
            <span className="flex items-center gap-1.5">
              <Skull className="h-3.5 w-3.5" />
              {hud.boss.name}
            </span>
            <span>{Math.ceil((hud.boss.hp / hud.boss.maxHp) * 100)}%</span>
          </div>
          <div className="mt-1 h-3 overflow-hidden rounded-[2px] border-2 border-ink bg-field-deep">
            <div className="h-full bg-enemy transition-[width] duration-150" style={{ width: `${(hud.boss.hp / hud.boss.maxHp) * 100}%` }} />
          </div>
        </div>
      ) : null}

      {/* banners */}
      <div className="pointer-events-none absolute inset-x-0 top-[24%] z-20 flex justify-center px-4 short:top-[30%]">
        <AnimatePresence>
          {banner && hud.status !== 'over' && hud.status !== 'won' ? (
            <motion.div key={banner.text + banner.kind} initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} className="text-center">
              <p className={`m-0 sign-lettering text-[clamp(1.8rem,6vw,4.2rem)] leading-none short:text-[1.6rem] ${banner.kind === 'boss' || banner.kind === 'over' ? 'text-enemy' : banner.kind === 'purge' ? 'text-brass-hot' : banner.kind === 'garrison' ? 'text-garrison' : banner.kind === 'ground' ? 'text-shield' : banner.kind === 'unlock' ? 'text-brass' : 'text-cream'}`}>
                {banner.text}
              </p>
              {banner.sub ? <p className="m-0 mt-2 max-w-[52ch] hud text-[0.66rem] text-dust [text-shadow:0_2px_0_#070b08] short:hidden">{banner.sub}</p> : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* targeting hint */}
      {targeting ? (
        <div className="pointer-events-none absolute inset-x-0 top-[14%] z-20 flex justify-center">
          <p className="m-0 rounded-[4px] border-2 border-brass bg-field-deep/90 px-3 py-1.5 hud text-[0.62rem] text-brass">
            {ABILITIES[targeting].name}: click the field · Esc cancels
          </p>
        </div>
      ) : null}

      {/* paused */}
      {hud.paused && playing && !modal && !logOpen ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="pointer-events-auto panel px-8 py-6 text-center">
            <p className="m-0 sign-lettering text-[2.4rem] leading-none text-cream">Paused</p>
            <button type="button" onClick={() => sim.togglePause()} className="btn-fire mt-4 cursor-pointer px-5 py-2.5 text-[0.7rem]">
              <Play className="h-4 w-4" />
              Resume
            </button>
          </div>
        </div>
      ) : null}

      {/* ───────── abilities, on the left ───────── */}
      {playing ? (
        <div className="pointer-events-auto absolute left-2 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1.5 sm:left-4 short:bottom-[5.4rem] short:top-auto short:translate-y-0 short:flex-row">
          {ABILITY_ORDER.map((k) => {
            const def = ABILITIES[k];
            const open = hud.abilityOpen[k];
            const cd = hud.abilities[k];
            const ready = open && cd <= 0;
            const total = def.cooldown * (hud.reload ? 0.8 : 1);
            const pct = ready ? 0 : Math.min(1, cd / total);
            return (
              <button
                key={k}
                type="button"
                onClick={() => (targeting === k ? armAbility(null) : armAbility(k))}
                disabled={!ready}
                title={open ? `${def.name} (${def.key}): ${def.blurb}` : `${def.name}: research it in the tech tree`}
                className={`panel relative h-12 w-12 cursor-pointer overflow-hidden p-0 text-left disabled:cursor-not-allowed sm:h-14 sm:w-14 short:h-10! short:w-10! ${targeting === k ? 'border-brass!' : ''} ${open ? '' : 'opacity-50'}`}
              >
                <span className="absolute inset-x-0 bottom-0 bg-field-deep/80" style={{ height: `${pct * 100}%` }} />
                <span className="absolute left-1 top-0.5 hud text-[0.5rem] text-dust-dim">{def.key}</span>
                <span className="absolute inset-0 flex items-center justify-center">
                  {open ? (
                    <span className="h-4 w-4 rounded-full border-2 border-ink" style={{ background: def.color, boxShadow: ready ? `0 0 10px ${def.color}` : 'none' }} />
                  ) : (
                    <Lock className="h-4 w-4 text-dust-dim" />
                  )}
                </span>
                <span className="absolute inset-x-0 bottom-0.5 truncate px-0.5 text-center hud text-[0.44rem] text-cream sm:text-[0.5rem] short:hidden">{ready ? def.name.split(' ')[0] : open ? `${Math.ceil(cd)}s` : 'locked'}</span>
              </button>
            );
          })}
          <button type="button" onClick={() => setModal('research')} className="panel flex h-12 w-12 cursor-pointer flex-col items-center justify-center gap-0.5 p-0 text-brass sm:h-14 sm:w-14 short:h-10! short:w-10!" title="Research (T)" aria-label="Open research">
            <FlaskConical className="h-4 w-4" />
            <span className="hud text-[0.44rem] sm:text-[0.5rem]">Tech</span>
          </button>
        </div>
      ) : null}

      {/* ───────── mount popover ───────── */}
      {selected !== null && popoverPos && playing && !targeting ? (
        <div
          ref={popoverRef}
          className="panel absolute z-[36] w-[min(15.5rem,calc(100vw-16px))] p-3"
          style={{ left: Math.min(Math.max(8, popoverPos.x - 124), window.innerWidth - Math.min(256, window.innerWidth - 8)), top: Math.max(8, popoverPos.y - (selectedTurret ? 150 : 232)) }}
        >
          <div className="flex items-center justify-between">
            <p className="m-0 hud text-[0.6rem] text-dust-dim">Mount {selected + 1}</p>
            <button type="button" onClick={() => selectSlot(null)} className="cursor-pointer text-dust hover:text-cream" aria-label="Close">
              <Close className="h-4 w-4" />
            </button>
          </div>
          {selectedTurret ? (
            <>
              <p className="m-0 mt-1 display text-[1.2rem] leading-none text-cream">
                {TURRETS[selectedTurret.kind].name}
                {selectedTurret.level >= 4 ? <span className="ml-2 hud text-[0.5rem] text-brass-hot">experimental</span> : null}
              </p>
              <p className="m-0 mt-1 text-[0.78rem] text-dust">
                Level {selectedTurret.level} / {hud.maxLevel} · dmg {(TURRETS[selectedTurret.kind].dmg * (1 + (selectedTurret.level - 1) * 0.55)).toFixed(1)}
              </p>
              <div className="mt-3 flex gap-2">
                {selectedTurret.level < hud.maxLevel ? (
                  <button type="button" onClick={() => sim.upgrade(selected)} disabled={hud.scrap < upgradeCost(TURRETS[selectedTurret.kind], selectedTurret.level)} className="btn-fire flex-1 cursor-pointer px-3 py-2 text-[0.62rem] disabled:cursor-not-allowed disabled:opacity-40">
                    {selectedTurret.level === 3 ? 'Experimental' : 'Upgrade'} · {upgradeCost(TURRETS[selectedTurret.kind], selectedTurret.level)}
                  </button>
                ) : (
                  <span className="hud flex-1 rounded-[4px] border-2 border-brass px-3 py-2 text-center text-[0.6rem] text-brass">Max level</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    sim.sell(selected);
                    selectSlot(null);
                  }}
                  className="btn-steel cursor-pointer px-3 py-2 text-[0.62rem]"
                >
                  Sell +{Math.round(selectedTurret.paid * hud.sellRate)}
                </button>
              </div>
            </>
          ) : (
            <ul className="m-0 mt-2 list-none space-y-1 p-0">
              {TURRET_ORDER.map((k) => {
                const def = TURRETS[k];
                const unlocked = hud.unlocked[k];
                const price = hud.costs[k];
                const can = unlocked && hud.scrap >= price;
                return (
                  <li key={k}>
                    <button
                      type="button"
                      disabled={!can}
                      onClick={() => {
                        sim.build(selected, k, inputRef.current);
                        selectSlot(null);
                      }}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[4px] border-2 border-steel-line px-2.5 py-1.5 text-left transition-colors hover:border-brass disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full border-2 border-ink" style={{ background: def.color }} />
                        <span className="hud text-[0.6rem] text-cream">{def.name}</span>
                      </span>
                      <span className="font-mono text-[0.72rem] text-brass">{unlocked ? (price === 0 ? 'FREE' : price) : <Lock className="h-3.5 w-3.5 text-dust-dim" />}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {/* ───────── bottom: build bar ───────── */}
      {playing ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-1.5 p-2 sm:gap-2 sm:p-4 short:gap-1 short:p-1.5">
          <p className="m-0 hidden hud text-[0.56rem] text-dust [text-shadow:0_2px_0_#070b08] sm:block short:hidden!">{engineLine}</p>
          <div className="pointer-events-auto flex w-full max-w-[68rem] items-stretch gap-1.5 sm:gap-2">
            <div className="flex min-w-0 flex-1 items-stretch gap-1.5 overflow-x-auto [scrollbar-width:none] sm:gap-2">
            {TURRET_ORDER.map((k, i) => {
              const def = TURRETS[k];
              const unlocked = hud.unlocked[k];
              const price = hud.costs[k];
              const on = buildKind === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => unlocked && setBuildKind(k)}
                  title={unlocked ? def.blurb : `Unlocks when ${def.unlockPct}% of the supply is purged, at wave ${def.unlockWave}, or by research`}
                  className={`panel min-w-[6.6rem] flex-1 cursor-pointer px-2.5 py-1.5 text-left transition-colors sm:min-w-[8.4rem] sm:px-3 sm:py-2 short:min-w-[5.6rem]! short:px-2! short:py-1! ${on ? 'border-brass!' : ''} ${unlocked ? '' : 'opacity-60'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="hud text-[0.52rem] text-dust-dim">{i + 1}</span>
                    {unlocked ? <span className="h-3 w-3 rounded-full border-2 border-ink" style={{ background: def.color }} /> : <Lock className="h-3.5 w-3.5 text-dust-dim" />}
                  </div>
                  <p className={`m-0 mt-1 display text-[0.85rem] leading-none sm:text-[0.95rem] ${on ? 'text-brass' : 'text-cream'}`}>{def.name}</p>
                  <p className="m-0 mt-1 font-mono text-[0.66rem] text-dust sm:text-[0.7rem] short:text-[0.58rem]">{unlocked ? (price === 0 ? 'free' : `${price} scrap`) : sim.unlockHint(k)}</p>
                </button>
              );
            })}
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <button type="button" onClick={() => sim.sendWave()} disabled={hud.status !== 'build'} className="btn-fire min-w-[8rem] flex-1 cursor-pointer px-3 text-[0.64rem] disabled:cursor-not-allowed sm:min-w-[9rem] short:min-w-[6.5rem]! short:py-1" aria-disabled={hud.status !== 'build'}>
                {hud.status === 'build' ? (
                  <span>
                    Send wave {hud.wave + 1}
                    <span className="ml-1 font-mono normal-case tracking-normal">({Math.ceil(hud.breakLeft)}s)</span>
                  </span>
                ) : (
                  <span>
                    Wave {hud.wave} · {hud.queued + hud.enemies} left
                  </span>
                )}
              </button>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => sim.togglePause()} className="btn-steel h-8 flex-1 cursor-pointer bg-field-deep/80 text-[0.6rem] short:h-7" title="Pause (P)">
                  {hud.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                </button>
                <button type="button" onClick={() => sim.setSpeed(hud.speed === 1 ? 2 : 1)} className={`btn-steel h-8 flex-1 cursor-pointer bg-field-deep/80 text-[0.6rem] short:h-7 ${hud.speed === 2 ? 'border-brass text-brass' : ''}`} title="Speed (F)">
                  <FastForward className="h-3.5 w-3.5" />
                  {hud.speed}x
                </button>
              </div>
            </div>
          </div>
          <p className="m-0 hidden hud text-[0.52rem] text-dust-dim lg:block">Click a mount to build · click the horde to strike · drag to orbit, wheel to zoom · 1–5 guns · Q W E R abilities · T tech · Space sends the wave · P pause · F speed</p>
        </div>
      ) : null}

      {/* ───────── title ───────── */}
      {hud.status === 'title' ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center overflow-y-auto px-4 py-20 text-center max-sm:justify-start max-sm:pt-[9.5rem] short:justify-start short:pb-6 short:pt-[4.6rem]">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} className="max-w-[46rem]">
            <BastionMark className="mx-auto h-14 w-14 sm:h-16 sm:w-16 short:hidden" />
            <p className="m-0 mt-3 hud text-[0.66rem] text-shield">{tokenSymbol} · Robinhood Chain · chain 4663</p>
            <h1 className="m-0 mt-2 sign-lettering text-[clamp(3rem,10vw,6.5rem)] leading-none text-cream short:text-[2.4rem]">BASTION</h1>
            <p className="m-0 mt-2 display text-[clamp(1rem,2.6vw,1.6rem)] text-brass">{TAGLINE}</p>
            <p className="mx-auto mt-4 max-w-[52ch] text-[clamp(0.88rem,1.3vw,1.05rem)] leading-relaxed text-dust short:hidden">
              Every trade arms the fortress. Every round the Warden buys {tokenSymbol} back and purges the red horde to 0x…dEaD. Hold the gate, build on the mounts, call in the airstrikes, and research the heavy guns.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 short:mt-3 short:gap-2">
              <button type="button" onClick={() => setModal('campaign')} className="btn-fire cursor-pointer px-7 py-4 text-[0.9rem] short:px-5 short:py-2.5 short:text-[0.75rem]">
                <Swords className="h-5 w-5" />
                Campaign
              </button>
              <button type="button" onClick={() => setModal('survival')} className="btn-fire cursor-pointer px-7 py-4 text-[0.9rem] short:px-5 short:py-2.5 short:text-[0.75rem]">
                <Play className="h-5 w-5" />
                Survival
              </button>
              <button type="button" onClick={() => setModal('manual')} className="btn-steel cursor-pointer px-5 py-4 text-[0.78rem] short:px-4 short:py-2.5 short:text-[0.68rem]">
                Field manual
              </button>
              {live ? (
                <a href={buyUrl(ca)} target="_blank" rel="noreferrer" className="btn-steel px-5 py-4 text-[0.78rem] no-underline">
                  Buy {tokenSymbol}
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              ) : (
                <a href={X_URL} target="_blank" rel="noreferrer" className="btn-steel px-5 py-4 text-[0.78rem] no-underline">
                  <XIcon className="h-4 w-4" />
                  {X_HANDLE}
                </a>
              )}
            </div>
            <div className="mx-auto mt-6 grid max-w-[44rem] grid-cols-2 gap-2 sm:grid-cols-5 short:mt-3 short:gap-1.5">
              <Stat label="Round" value={String(round)} />
              <Stat label="Purged" value={`${burnedPct.toFixed(2)}%`} tone="text-brass" />
              <Stat label="War chest" value={`${Math.round(fill * 100)}%`} tone="text-shield" />
              <Stat label="Best wave" value={String(hud.bestWave)} />
              <Stat label="Missions" value={`${Object.keys(campaign.stars).length} / ${MISSIONS.length}`} tone="text-garrison" />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {perks ? (
                <span className="flex items-center gap-2 rounded-[4px] border-2 border-brass/60 px-3 py-2 hud text-[0.6rem] text-brass">
                  <Wallet className="h-3.5 w-3.5" />
                  {perks.title} · {perks.address.slice(0, 6)}…{perks.address.slice(-4)}
                  <span className="text-dust">
                    · +{perks.bonusScrap} scrap{perks.freeSentry ? ' · free Sentry' : ''}
                    {perks.rank ? ` · rank #${perks.rank}` : ''}
                  </span>
                </span>
              ) : (
                <button type="button" onClick={connectWallet} disabled={!live || connecting} className="btn-steel cursor-pointer px-4 py-2.5 text-[0.66rem] disabled:cursor-not-allowed disabled:opacity-50" title="Read-only: your holding and rank become perks">
                  <Wallet className="h-4 w-4" />
                  {connecting ? 'Reading the chain…' : live ? 'Connect wallet for holder perks' : 'Holder perks open with the CA'}
                </button>
              )}
              {walletError ? <span className="hud text-[0.58rem] text-enemy">{walletError}</span> : null}
            </div>
            <p className="m-0 mt-2 hud text-[0.52rem] text-dust-dim">
              Hold any {tokenSymbol}: +{HOLDER_TIERS[1].bonusScrap} scrap · hold at least {HOLDER_TIERS[0].minPct}% of the supply: +{HOLDER_TIERS[0].bonusScrap} scrap and a free Sentry · top 10 on the board: a title. Read-only, nothing is spent.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {live ? (
                <>
                  <button type="button" onClick={copyCA} className="flex max-w-full cursor-pointer items-center gap-2 rounded-[4px] border-2 border-dashed border-steel-line px-3 py-1.5 font-mono text-[0.72rem] text-cream hover:border-brass sm:text-[0.78rem]">
                    <span className="truncate">{ca}</span>
                    {copiedCA ? <Check className="h-3.5 w-3.5 shrink-0 text-brass" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-dust" />}
                  </button>
                  <a href={chartUrl(ca)} target="_blank" rel="noreferrer" className="hud text-[0.62rem] text-dust no-underline hover:text-brass">
                    Chart ↗
                  </a>
                </>
              ) : (
                <span className="hud text-[0.62rem] text-dust-dim">CA drops on {X_HANDLE} and here. Never in your DMs.</span>
              )}
            </div>
          </motion.div>
          <p className="absolute bottom-3 m-0 hud text-[0.52rem] text-dust-dim sm:text-[0.56rem] short:hidden">
            Space opens the campaign · {fmt(totalBurned)} {tokenSymbol} already purged
          </p>
        </div>
      ) : null}

      {/* ───────── game over / mission won ───────── */}
      {hud.status === 'over' || hud.status === 'won' ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto px-4 py-6 text-center">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="panel my-auto max-h-[92svh] max-w-[30rem] overflow-y-auto p-6 sm:p-7 short:p-4">
            <p className={`m-0 hud text-[0.66rem] ${hud.status === 'won' ? 'text-garrison' : 'text-enemy'}`}>{hud.status === 'won' ? 'Ground held' : 'The gate has fallen'}</p>
            <p className="m-0 mt-2 sign-lettering text-[clamp(2.4rem,7vw,4rem)] leading-none text-cream">{hud.status === 'won' && hud.mission ? hud.mission.name : `Wave ${hud.wave}`}</p>
            {hud.status === 'won' ? (
              <div className="mt-3 flex justify-center gap-1">
                {[1, 2, 3].map((i) => (
                  <Star key={i} className={`h-7 w-7 ${i <= hud.stars ? 'fill-brass text-brass' : 'text-steel-line'}`} />
                ))}
              </div>
            ) : null}
            <div className="mt-5 grid grid-cols-3 gap-2">
              <Stat label="Kills" value={String(hud.kills)} />
              <Stat label="Blocked by shield" value={String(hud.shieldBlocks)} tone="text-shield" />
              <Stat label={hud.mission ? 'Gate left' : 'Best'} value={hud.mission ? `${hud.hp} / ${hud.maxHp}` : String(hud.bestWave)} tone="text-brass" />
            </div>
            <p className="mx-auto mt-4 max-w-[36ch] text-[0.92rem] leading-relaxed text-dust">
              {hud.status === 'won'
                ? nextMission
                  ? `${nextMission.name} is open. Research carries over.`
                  : 'The campaign is complete. The grounds are open for survival.'
                : `The horde took the gate, but nothing it did reaches the chain: every ${tokenSymbol} the Warden purged stays in 0x…dEaD.`}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {hud.status === 'won' && nextMission ? (
                <button type="button" onClick={() => startMission(nextMission)} className="btn-fire cursor-pointer px-6 py-3 text-[0.78rem]">
                  <Play className="h-4 w-4" />
                  Next mission
                </button>
              ) : (
                <button type="button" onClick={restart} className="btn-fire cursor-pointer px-6 py-3 text-[0.78rem]">
                  <Play className="h-4 w-4" />
                  {hud.status === 'won' ? 'Replay' : 'Rebuild'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  sim.toTitle();
                  sfx.stopMusic();
                }}
                className="btn-steel cursor-pointer px-5 py-3 text-[0.72rem]"
              >
                Title
              </button>
              <button type="button" onClick={() => setModal('leaderboard')} className="btn-steel cursor-pointer px-5 py-3 text-[0.72rem]">
                <Trophy className="h-4 w-4" />
                Board
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}

      {/* ───────── portrait hint ───────── */}
      {portrait && !portraitOk ? (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-field-deep/95 px-6 text-center">
          <Smartphone className="h-10 w-10 rotate-90 text-brass" />
          <p className="m-0 mt-4 sign-lettering text-[1.8rem] leading-none text-cream">Turn your phone</p>
          <p className="mx-auto mt-2 max-w-[30ch] text-[0.95rem] leading-relaxed text-dust">The arena is wide. Landscape gives the guns room to work.</p>
          <button type="button" onClick={() => setPortraitOk(true)} className="btn-steel mt-5 cursor-pointer px-5 py-3 text-[0.72rem]">
            Play in portrait anyway
          </button>
        </div>
      ) : null}

      {/* ───────── modals ───────── */}
      <AnimatePresence>
        {modal ? (
          <motion.div key={modal} className="absolute inset-0 z-40 flex items-end justify-center bg-field-deep/80 p-0 sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModal(null)}>
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="panel relative max-h-[92svh] w-full max-w-[72rem] overflow-y-auto p-0 [&_section]:px-5! [&_section]:py-6! sm:[&_section]:px-8!"
            >
              <button type="button" autoFocus onClick={() => setModal(null)} className="btn-steel sticky top-3 z-10 ml-auto mr-3 mt-3 h-9 w-9 cursor-pointer bg-field-deep" aria-label="Close">
                <Close className="h-4 w-4" />
              </button>
              <div className="-mt-6">
                {modal === 'leaderboard' ? <Leaderboard board={board} loading={boardLoading} error={boardError} live={live} tokenSymbol={tokenSymbol} explorerUrl={EXPLORER_URL} /> : null}
                {modal === 'milestones' ? <Milestones burnedPct={burnedPct} totalBurned={totalBurned} tokenSymbol={tokenSymbol} deadAddress={deadAddress} copiedDead={copiedDead} onCopyDead={copyDead} explorerUrl={EXPLORER_URL} live={live} /> : null}
                {modal === 'rounds' ? (
                  <Rounds
                    burnLedger={live ? burnLedger : []}
                    roundsFought={live ? state.cycleCount : 0}
                    unitsDestroyed={totalBurned}
                    ralliedETH={live ? state.totalFeesClaimedETH || 0 : 0}
                    tokenSymbol={tokenSymbol}
                    explorerUrl={EXPLORER_URL}
                    live={live}
                    onOpenLog={() => {
                      setModal(null);
                      setLogOpen(true);
                    }}
                  />
                ) : null}
                {modal === 'command' ? (
                  <CommandCenter
                    state={state}
                    config={config}
                    split={split}
                    logs={live ? logs : []}
                    live={live}
                    explorerUrl={EXPLORER_URL}
                    onOpenLog={() => {
                      setModal(null);
                      setLogOpen(true);
                    }}
                  />
                ) : null}
                {modal === 'campaign' ? (
                  <section className="px-5 py-6">
                    <p className="m-0 hud text-[0.7rem] text-enemy">Campaign</p>
                    <h2 className="m-0 mt-2 sign-lettering text-[clamp(2rem,4vw,3.2rem)] leading-[0.95] text-cream">Missions</h2>
                    <p className="mt-3 max-w-[60ch] text-[0.95rem] leading-relaxed text-dust">Six grounds, each with its own waves. Clearing one opens the next and its ground for survival. Research carries over between missions.</p>
                    <ol className="m-0 mt-6 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
                      {MISSIONS.map((m) => {
                        const open = missionUnlocked(campaign, m);
                        const stars = campaign.stars[m.id] ?? 0;
                        return (
                          <li key={m.id} className={`rounded-[6px] border-2 p-4 ${open ? 'border-steel-line' : 'border-steel-line/50 opacity-60'}`}>
                            <div className="flex items-center justify-between">
                              <span className="hud text-[0.58rem] text-dust-dim">Mission {m.id} · {m.waves} waves</span>
                              <span className="flex gap-0.5">
                                {[1, 2, 3].map((i) => (
                                  <Star key={i} className={`h-3.5 w-3.5 ${i <= stars ? 'fill-brass text-brass' : 'text-steel-line'}`} />
                                ))}
                              </span>
                            </div>
                            <p className="m-0 mt-2 display text-[1.3rem] leading-none text-cream">{m.name}</p>
                            <p className="m-0 mt-1 hud text-[0.52rem] text-shield">{MAPS[m.map].name} · boss every {m.bossEvery}</p>
                            <p className="m-0 mt-2 text-[0.86rem] leading-snug text-dust">{m.briefing}</p>
                            <button type="button" onClick={() => startMission(m)} disabled={!open} className="btn-fire mt-3 w-full cursor-pointer px-3 py-2 text-[0.64rem] disabled:cursor-not-allowed disabled:opacity-40">
                              {open ? (stars ? 'Replay' : 'Deploy') : <Lock className="h-3.5 w-3.5" />}
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ) : null}
                {modal === 'survival' ? (
                  <section className="px-5 py-6">
                    <p className="m-0 hud text-[0.7rem] text-shield">Survival</p>
                    <h2 className="m-0 mt-2 sign-lettering text-[clamp(2rem,4vw,3.2rem)] leading-[0.95] text-cream">How long can you hold?</h2>
                    <p className="mt-3 max-w-[60ch] text-[0.95rem] leading-relaxed text-dust">Endless waves, a boss every fifth. Every ten waves the fortress moves to the next open ground and your guns are refunded. Best wave: {hud.bestWave}.</p>
                    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {MAPS.map((m) => {
                        const open = survivalMaps(campaign).includes(m.id);
                        return (
                          <button key={m.id} type="button" disabled={!open} onClick={() => startSurvival([m.id, ...survivalMaps(campaign).filter((id) => id !== m.id)])} className={`rounded-[6px] border-2 p-4 text-left ${open ? 'cursor-pointer border-steel-line hover:border-brass' : 'cursor-not-allowed border-steel-line/50 opacity-60'}`}>
                            <div className="flex items-center justify-between">
                              <span className="hud text-[0.58rem] text-dust-dim">
                                <MapIcon className="mr-1 inline h-3.5 w-3.5" />
                                {m.lanes.length} lane{m.lanes.length > 1 ? 's' : ''} · {m.slots.length} mounts
                              </span>
                              {open ? null : <Lock className="h-3.5 w-3.5 text-dust-dim" />}
                            </div>
                            <p className="m-0 mt-2 display text-[1.3rem] leading-none text-cream">{m.name}</p>
                            <p className="m-0 mt-1 text-[0.86rem] text-dust">{open ? m.tagline : 'Clear its mission to open it.'}</p>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
                {modal === 'research' ? (
                  <section className="px-5 py-6">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="m-0 hud text-[0.7rem] text-brass">Tech tree</p>
                        <h2 className="m-0 mt-2 sign-lettering text-[clamp(2rem,4vw,3.2rem)] leading-[0.95] text-cream">Research</h2>
                      </div>
                      <p className="m-0 display text-[1.4rem] text-brass tabular">{hud.scrap} scrap</p>
                    </div>
                    <p className="mt-3 max-w-[60ch] text-[0.95rem] leading-relaxed text-dust">Spend scrap once, keep it forever on this device. Guns researched here open on every mount regardless of the chain or the wave.</p>
                    {[1, 2, 3].map((tier) => (
                      <div key={tier} className="mt-5">
                        <p className="m-0 hud text-[0.6rem] text-dust-dim">Tier {tier}</p>
                        <ul className="m-0 mt-2 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-4">
                          {RESEARCH.filter((r) => r.tier === tier).map((r) => {
                            const owned = hud.research.includes(r.id);
                            const can = !owned && hud.researchable.includes(r.id);
                            const afford = hud.scrap >= r.cost;
                            const tone = r.kind === 'gun' ? 'text-brass' : r.kind === 'ability' ? 'text-shield' : 'text-garrison';
                            return (
                              <li key={r.id} className={`rounded-[6px] border-2 p-3 ${owned ? 'border-brass/60 bg-brass/10' : can ? 'border-steel-line' : 'border-steel-line/50 opacity-60'}`}>
                                <div className="flex items-center justify-between">
                                  <span className={`hud text-[0.54rem] ${tone}`}>{r.kind}</span>
                                  {owned ? <Check className="h-3.5 w-3.5 text-brass" /> : can ? null : <Lock className="h-3.5 w-3.5 text-dust-dim" />}
                                </div>
                                <p className="m-0 mt-1.5 display text-[1.05rem] leading-none text-cream">{r.name}</p>
                                <p className="m-0 mt-1.5 text-[0.8rem] leading-snug text-dust">{r.blurb}</p>
                                {r.requires && !owned ? <p className="m-0 mt-1 hud text-[0.5rem] text-dust-dim">needs {RESEARCH.find((q) => q.id === r.requires)?.name}</p> : null}
                                <button type="button" onClick={() => sim.buyResearch(r.id)} disabled={!can || !afford} className="btn-fire mt-2.5 w-full cursor-pointer px-3 py-1.5 text-[0.6rem] disabled:cursor-not-allowed disabled:opacity-40">
                                  {owned ? 'Researched' : `${r.cost} scrap`}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </section>
                ) : null}
                {modal === 'manual' ? (
                  <section className="px-5 py-6">
                    <p className="m-0 hud text-[0.7rem] text-brass">How the fortress holds</p>
                    <h2 className="m-0 mt-2 sign-lettering text-[clamp(2rem,4vw,3.2rem)] leading-[0.95] text-cream">Field manual</h2>
                    <ol className="m-0 mt-6 grid list-none gap-4 p-0 sm:grid-cols-2">
                      {MANUAL.map((d, i) => (
                        <li key={d.title} className="rounded-[6px] border-2 border-steel-line p-5">
                          <span className="hud text-[0.58rem] text-dust-dim">0{i + 1}</span>
                          <h3 className="m-0 mt-1 display text-[1.4rem] text-cream">{d.title}</h3>
                          <p className="m-0 mt-2 text-[0.95rem] leading-relaxed text-dust">{d.text}</p>
                        </li>
                      ))}
                    </ol>
                    <div className="mt-6 grid gap-4 lg:grid-cols-3">
                      <div className="rounded-[6px] border-2 border-brass/50 p-5">
                        <h3 className="m-0 display text-[1.4rem] text-brass">Playing the field</h3>
                        <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-[0.95rem] leading-relaxed text-dust">
                          <li>Click a mount to build a gun with scrap. Kills and held waves pay scrap. Upgrade, sell, or push to the experimental stage once researched.</li>
                          <li>Every unit that reaches the gate costs HP. The war chest is the shield: at 100% it throws almost every leak back.</li>
                          <li>Guns open three ways: the real purged supply (Gatling 0.5%, Tesla 2%, Rail 5%, Lance 13%), the wave you reach (3, 6, 9, 13), or research.</li>
                          <li>Campaign: six missions, stars for the gate you keep. Survival: endless, new ground every ten waves.</li>
                          <li>Connect a wallet for holder perks. Every purge the Warden runs on chain pays every active defender scrap.</li>
                          <li>P pauses, F toggles 2× speed, T opens research, Space sends the next wave.</li>
                        </ul>
                      </div>
                      <div className="rounded-[6px] border-2 border-shield/50 p-5">
                        <h3 className="m-0 display text-[1.4rem] text-shield">Abilities</h3>
                        <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-[0.92rem] leading-snug text-dust">
                          {ABILITY_ORDER.map((k) => (
                            <li key={k} className="flex gap-2">
                              <span className="hud w-6 shrink-0 text-[0.58rem] text-cream">{ABILITIES[k].key}</span>
                              <span>
                                <span className="text-cream">{ABILITIES[k].name}.</span> {ABILITIES[k].blurb} {ABILITIES[k].cooldown}s cooldown; a fuller war chest reloads it faster.
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-[6px] border-2 border-enemy/50 p-5">
                        <h3 className="m-0 display text-[1.4rem] text-enemy">The horde</h3>
                        <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-[0.92rem] leading-snug text-dust">
                          {(Object.keys(ENEMIES) as (keyof typeof ENEMIES)[]).map((k) => (
                            <li key={k} className="flex gap-2">
                              <span className="hud w-16 shrink-0 text-[0.58rem] text-cream">{k}</span>
                              <span>{ENEMIES[k].blurb}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </section>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <BurnLedgerDrawer isOpen={logOpen} onClose={() => setLogOpen(false)} logs={live ? logs : []} burnLedger={live ? burnLedger : []} state={state} config={config} />
    </div>
  );
}

function HudButton({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="btn-steel h-8 cursor-pointer gap-1.5 bg-field-deep/80 px-2.5 text-[0.58rem]">
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-[4px] border-2 border-steel-line bg-field-deep/70 px-3 py-2 text-left">
      <p className="m-0 hud text-[0.52rem] text-dust-dim">{label}</p>
      <p className={`m-0 mt-0.5 display text-[1.1rem] leading-none tabular ${tone ?? 'text-cream'}`}>{value}</p>
    </div>
  );
}

function snapshot(sim: Sim, burnedPct: number) {
  const s = sim.s;
  const unlocked = Object.fromEntries(TURRET_ORDER.map((k) => [k, sim.unlocked(k, burnedPct)])) as Record<TurretKind, boolean>;
  const costs = Object.fromEntries(TURRET_ORDER.map((k) => [k, sim.cost(k)])) as Record<TurretKind, number>;
  const abilityOpen = Object.fromEntries(ABILITY_ORDER.map((k) => [k, sim.abilityOpen(k)])) as Record<AbilityKind, boolean>;
  return {
    unlocked,
    costs,
    abilityOpen,
    abilities: { ...s.abilities },
    reload: sim.owned('reload'),
    research: [...sim.research] as ResearchId[],
    researchable: RESEARCH.filter((r) => sim.researchable(r.id)).map((r) => r.id),
    maxLevel: sim.maxLevel(),
    sellRate: sim.sellRate(),
    title: s.perks?.title ?? '',
    status: s.status,
    wave: s.wave,
    bestWave: s.bestWave,
    scrap: s.scrap,
    hp: s.hp,
    maxHp: s.maxHp,
    kills: s.kills,
    stars: s.stars,
    shieldBlocks: s.shieldBlocks,
    breakLeft: s.breakLeft,
    queued: s.queue.length,
    enemies: s.enemies.length,
    paused: s.paused,
    speed: s.speed,
    mapName: sim.map.name,
    mission: sim.mission,
    boss: s.boss ? { name: s.boss.name ?? 'Boss', hp: s.boss.hp, maxHp: s.boss.maxHp } : null,
    turrets: s.turrets.map((t) => ({ slot: t.slot, kind: t.kind, level: t.level, paid: t.paid })),
  };
}
