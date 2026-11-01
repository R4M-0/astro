'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { GEdge, GNode } from './types';

export interface GalaxyHandle {
  flyTo: (ref: string) => void;
  home: () => void;
}

interface Props {
  nodes: GNode[];
  links: GEdge[];
  clusterOf: (n: GNode) => string;
  clusterColor: (key: string) => string;
  colorOf: (n: GNode) => string;
  nodeVisible: (n: GNode) => boolean;
  linkVisible: (l: GEdge) => boolean;
  linkColor: (l: GEdge) => string;
  highlight: Set<string>;
  group: Set<string>;
  selected: string | null;
  bridges: Set<string>;
  width: number;
  height: number;
  onNodeClick: (n: GNode, additive: boolean) => void;
  onBackgroundClick: () => void;
}

const SIZE: Record<string, number> = { Executive: 26, Head: 20, Lead: 15, Senior: 12, Mid: 11, Junior: 9, Apprentice: 8, Intern: 8 };
const refOf = (x: string | GNode) => (typeof x === 'string' ? x : x.ref);

let glowTexture: THREE.Texture | null = null;
function glow() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

function textSprite(text: string, color: string) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = '600 44px ui-sans-serif, system-ui, sans-serif';
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 40;
  c.height = 64;
  g.font = font;
  g.fillStyle = color;
  g.globalAlpha = 0.85;
  g.textBaseline = 'middle';
  g.fillText(text, 20, 34);
  // constant on-screen size: world-sized labels turn huge (and bloom) when the camera flies in
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, sizeAttenuation: false, opacity: 0.8 }));
  s.scale.set((c.width / c.height) * 0.03, 0.03, 1);
  return s;
}

/** Points on a sphere, evenly spread (Fibonacci). */
function sphere(n: number, r: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = Math.PI * (3 - Math.sqrt(5)) * i;
    pts.push(new THREE.Vector3(Math.cos(th) * rad * r, y * r * 0.7, Math.sin(th) * rad * r));
  }
  return pts;
}

export const GalaxyCanvas = forwardRef<GalaxyHandle, Props>(function GalaxyCanvas(p, ref) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fg = useRef<any>(null);
  const labels = useRef<THREE.Group | null>(null);
  const placeLabels = useRef(() => {});
  const ticks = useRef(0);
  const graphData = useMemo(() => ({ nodes: p.nodes, links: p.links }), [p.nodes, p.links]);

  useImperativeHandle(ref, () => ({
    flyTo(r) {
      const n = p.nodes.find((x) => x.ref === r);
      if (!n || n.x === undefined || !fg.current) return;
      const d = 170;
      const ratio = 1 + d / Math.max(1, Math.hypot(n.x, n.y!, n.z!));
      const cam = new THREE.Vector3(n.x * ratio, n.y! * ratio + 20, n.z! * ratio);
      // look slightly to the star's right so it sits left of center, clear of the employee panel
      const right = new THREE.Vector3(n.x, n.y, n.z).sub(cam).normalize().cross(new THREE.Vector3(0, 1, 0)).normalize();
      const look = new THREE.Vector3(n.x, n.y, n.z).addScaledVector(right, 55);
      fg.current.cameraPosition({ x: cam.x, y: cam.y, z: cam.z }, { x: look.x, y: look.y, z: look.z }, 1400);
    },
    home() {
      fg.current?.cameraPosition({ x: 0, y: 380, z: 1750 }, { x: 0, y: 0, z: 0 }, 1400);
    },
  }));

  // scene setup: bloom, starfield, camera
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    // high threshold: stars bloom, faint beams don't (otherwise the core turns into a white blob)
    const bloom = new UnrealBloomPass(new THREE.Vector2(p.width, p.height), 1.1, 0.45, 0.32);
    g.postProcessingComposer().addPass(bloom);
    const starGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(6000 * 3);
    for (let i = 0; i < 6000; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(1800 + Math.random() * 2600);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9fb4ff, size: 2.2, transparent: true, opacity: 0.55, depthWrite: false }));
    g.scene().add(stars);
    g.d3Force('charge').strength(-80);
    g.cameraPosition({ x: 0, y: 380, z: 1750 });
    const controls = g.controls();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.25;
    }
    return () => {
      g.scene().remove(stars);
      g.postProcessingComposer().removePass(bloom);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // idle rotation until the first interaction, then never again (it would move stars under the cursor)
  useEffect(() => {
    const controls = fg.current?.controls();
    if (controls && (p.selected || p.highlight.size || p.group.size)) controls.autoRotate = false;
  }, [p.selected, p.highlight, p.group]);

  // cluster forces + labels for the current lens
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    const counts = new Map<string, number>();
    for (const n of p.nodes) counts.set(p.clusterOf(n), (counts.get(p.clusterOf(n)) ?? 0) + 1);
    const keys = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!);
    const pts = sphere(keys.length, 260 + keys.length * 34);
    const centers = new Map(keys.map((k, i) => [k, pts[i]]));
    let nodes: GNode[] = [];
    const force = (alpha: number) => {
      for (const n of nodes as (GNode & { vx: number; vy: number; vz: number })[]) {
        const c = centers.get(p.clusterOf(n))!;
        n.vx += (c.x - n.x!) * 0.16 * alpha;
        n.vy += (c.y - n.y!) * 0.16 * alpha;
        n.vz += (c.z - n.z!) * 0.16 * alpha;
      }
    };
    force.initialize = (ns: GNode[]) => (nodes = ns);
    g.d3Force('cluster', force);
    g.d3Force('link').strength((l: GEdge) => {
      const s = p.nodes.find((n) => n.ref === refOf(l.source)), t = p.nodes.find((n) => n.ref === refOf(l.target));
      return s && t && p.clusterOf(s) === p.clusterOf(t) ? 0.05 : 0.0008;
    });
    g.d3ReheatSimulation();

    if (labels.current) g.scene().remove(labels.current);
    const group = new THREE.Group();
    for (const k of keys) {
      const s = textSprite(k, p.clusterColor(k));
      const c = centers.get(k)!;
      s.position.set(c.x, c.y + 40 + Math.sqrt(counts.get(k)!) * 6, c.z);
      s.userData = { key: k, lift: 30 + Math.sqrt(counts.get(k)!) * 6 };
      group.add(s);
    }
    g.scene().add(group);
    labels.current = group;
    // labels follow where each cluster actually settles
    placeLabels.current = () => {
      const acc = new Map<string, [number, number, number, number]>();
      for (const n of p.nodes) {
        if (n.x === undefined) continue;
        const a = acc.get(p.clusterOf(n)) ?? [0, 0, 0, 0];
        acc.set(p.clusterOf(n), [a[0] + n.x, a[1] + n.y!, a[2] + n.z!, a[3] + 1]);
      }
      for (const s of group.children) {
        const a = acc.get(s.userData.key);
        if (a) s.position.set(a[0] / a[3], a[1] / a[3] + s.userData.lift, a[2] / a[3]);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.clusterOf, p.nodes]);

  // star objects are built once per node; restyle() below updates them in place
  const makeStar = useCallback((n: GNode & { __glow?: THREE.Sprite; __ring?: THREE.Mesh }) => {
    const group = new THREE.Group();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const s = SIZE[n.level] ?? 10;
    sprite.scale.set(s, s, 1);
    const ring = new THREE.Mesh(new THREE.RingGeometry(s * 0.55, s * 0.62, 48), new THREE.MeshBasicMaterial({ color: '#ffd166', side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    ring.visible = false;
    group.add(sprite, ring);
    n.__glow = sprite;
    n.__ring = ring;
    setTimeout(() => restyleRef.current(), 0);
    return group;
  }, []);

  // live restyle (no rebuild): dim non-highlighted stars, mark selection and group
  const restyleRef = useRef(() => {});
  restyleRef.current = () => {
    for (const n of p.nodes as (GNode & { __glow?: THREE.Sprite; __ring?: THREE.Mesh })[]) {
      if (!n.__glow) continue;
      const dim = p.highlight.size > 0 && !p.highlight.has(n.ref) && n.ref !== p.selected;
      const mat = n.__glow.material as THREE.SpriteMaterial;
      mat.color.set(p.colorOf(n));
      mat.opacity = dim ? 0.08 : n.exitDate ? 0.35 : 1;
      const base = (SIZE[n.level] ?? 10) * (1 + Math.min(n.activity, 30) / 60) * (p.bridges.has(n.ref) ? 1.6 : 1);
      const s = n.ref === p.selected ? base * 1.9 : p.highlight.has(n.ref) ? base * 1.35 : base;
      n.__glow.scale.set(s, s, 1);
      if (n.__ring) {
        n.__ring.visible = p.group.has(n.ref) || n.ref === p.selected || p.bridges.has(n.ref);
        (n.__ring.material as THREE.MeshBasicMaterial).color.set(n.ref === p.selected ? '#ffffff' : p.group.has(n.ref) ? '#ffd166' : '#c4a1ff');
      }
    }
  };
  useEffect(() => restyleRef.current(), [p.nodes, p.highlight, p.group, p.selected, p.colorOf, p.bridges]);

  const linkTouches = (l: GEdge, r: string | null) => !!r && (refOf(l.source) === r || refOf(l.target) === r);

  return (
    <ForceGraph3D
      ref={fg}
      graphData={graphData}
      width={p.width}
      height={p.height}
      backgroundColor="#03040b"
      showNavInfo={false}
      nodeId="ref"
      nodeLabel={(n: GNode) => `<div style="padding:4px 8px;background:rgba(8,10,24,.85);border:1px solid rgba(255,255,255,.15);border-radius:8px;font:12px system-ui;color:#fff"><b>${n.name}</b><br/><span style="opacity:.7">${n.title ?? ''} · ${n.department}</span></div>`}
      nodeVisibility={p.nodeVisible}
      nodeThreeObject={makeStar}
      onEngineTick={() => {
        if (ticks.current++ % 5 === 0) placeLabels.current();
        // rings face the camera
        const cam = fg.current?.camera();
        if (!cam) return;
        for (const n of p.nodes as (GNode & { __ring?: THREE.Mesh })[]) if (n.__ring?.visible) n.__ring.quaternion.copy(cam.quaternion);
      }}
      linkVisibility={(l: GEdge) => (p.linkVisible(l) && (l.weight >= 2 || !!l.tree)) || (!l.tree && linkTouches(l, p.selected))}
      linkColor={(l: GEdge) =>
        linkTouches(l, p.selected) ? '#ffe9a8'
          // with a highlight active, beams that don't touch it fade out
          : p.highlight.size && !p.highlight.has(refOf(l.source)) && !p.highlight.has(refOf(l.target)) ? 'rgba(120,130,200,0.03)'
          : p.linkColor(l)}
      linkOpacity={0.35}
      linkWidth={(l: GEdge) => (linkTouches(l, p.selected) ? 0.9 : 0)}
      linkDirectionalParticles={(l: GEdge) => (linkTouches(l, p.selected) ? Math.min(6, 1 + Math.round(Math.log2(l.weight + 1))) : 0)}
      linkDirectionalParticleWidth={1.6}
      linkDirectionalParticleSpeed={0.006}
      linkDirectionalParticleColor={() => '#ffe9a8'}
      onNodeClick={(n: GNode, ev: MouseEvent) => p.onNodeClick(n, ev.shiftKey || ev.metaKey || ev.ctrlKey)}
      onBackgroundClick={p.onBackgroundClick}
      cooldownTicks={220}
      warmupTicks={40}
    />
  );
});
