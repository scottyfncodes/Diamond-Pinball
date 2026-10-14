import * as THREE from 'three';
import type { BaseballState } from '../baseball/types';
import { TABLE, type TableDef } from '../table/layout';
import { PLAYER_SIDE, TEAM_NAMES } from '../game/Game';

/** Display face (field paint, scoreboards): Oswald, self-hosted. */
export const DISPLAY = '"Oswald", "Arial Narrow", Impact, sans-serif';
/** Jersey script for wordmarks: Yellowtail, self-hosted. */
export const SCRIPT = '"Yellowtail", "Brush Script MT", cursive';

export interface Theme {
  id: string;
  name: string;
  cabinet: string;
  cabinetDark: string;
  rail: number;
  railMetalness: number;
  accent: string;
  accent2: string;
  grass: [string, string];
  dirt: string;
  apron: string;
  glow: number;
  /** Ribbon / pinstripe / slingshot colour. */
  trim?: string;
  /** Glossy flake-painted cabinet instead of wood grain. */
  lacquer?: boolean;
}

export const THEMES: Record<string, Theme> = {
  classic: { id: 'classic', name: 'All-Star', cabinet: '#17337f', cabinetDark: '#081538', rail: 0xe4e8ef, railMetalness: 1, accent: '#f4b942', accent2: '#4a9cff', grass: ['#2f8a40', '#2a7d3a'], dirt: '#b8683c', apron: '#162a6b', glow: 0xffc46a, trim: '#d2232a', lacquer: true },
  oak: { id: 'oak', name: 'Classic Oak', cabinet: '#7a4a24', cabinetDark: '#4a2a12', rail: 0xc9ccd1, railMetalness: 0.9, accent: '#f5c542', accent2: '#2c7be5', grass: ['#2f8a3c', '#2a7d36'], dirt: '#b7733b', apron: '#13213f', glow: 0xffc24d },
  gold: { id: 'gold', name: 'Gold Rails', cabinet: '#5a2d12', cabinetDark: '#331a0a', rail: 0xe3b341, railMetalness: 1, accent: '#ffd76a', accent2: '#1f5fbf', grass: ['#2f8a3c', '#2a7d36'], dirt: '#b7733b', apron: '#1a1733', glow: 0xffd76a },
  neon: { id: 'neon', name: 'Neon Night Game', cabinet: '#1a1f3a', cabinetDark: '#0d1022', rail: 0x9be7ff, railMetalness: 0.8, accent: '#ff4fd8', accent2: '#4fe3ff', grass: ['#1f6f3a', '#1a6333'], dirt: '#a0633a', apron: '#0b0b26', glow: 0x4fe3ff },
  cherry: { id: 'cherry', name: 'Cherry Cabinet', cabinet: '#8c1d1d', cabinetDark: '#4f0f0f', rail: 0xd9d9d9, railMetalness: 0.9, accent: '#ffe08a', accent2: '#c81e1e', grass: ['#2f8a3c', '#2a7d36'], dirt: '#b7733b', apron: '#2a0d0d', glow: 0xff8a5c },
  champion: { id: 'champion', name: 'Champion Pennants', cabinet: '#1d3d8c', cabinetDark: '#0f204a', rail: 0xe3b341, railMetalness: 1, accent: '#ffffff', accent2: '#e0312d', grass: ['#2f8a3c', '#2a7d36'], dirt: '#b7733b', apron: '#0f1c44', glow: 0xffffff },
  rooftop: { id: 'rooftop', name: 'Rooftop Arena', cabinet: '#3b3f4a', cabinetDark: '#1d2027', rail: 0xd8dde6, railMetalness: 0.85, accent: '#ff8a3b', accent2: '#4fe3ff', grass: ['#2f8a3c', '#2a7d36'], dirt: '#8a8f99', apron: '#141821', glow: 0xff8a3b },
  lunar: { id: 'lunar', name: 'Lunar Park', cabinet: '#2a2f45', cabinetDark: '#13162a', rail: 0xe8ecf5, railMetalness: 0.95, accent: '#9be7ff', accent2: '#c77dff', grass: ['#5a6378', '#4d566a'], dirt: '#9aa0ad', apron: '#0a0b1e', glow: 0x9be7ff },
  cosmic: { id: 'cosmic', name: 'Cosmic Championship', cabinet: '#2b0f4a', cabinetDark: '#14062a', rail: 0xffd36a, railMetalness: 1, accent: '#ff4fd8', accent2: '#4fe3ff', grass: ['#1f5f6a', '#1a5460'], dirt: '#5a3a7a', apron: '#120626', glow: 0xff4fd8 },
};

/** Stitched baseball skin for pinballs. */
export function createBaseballTexture(): THREE.CanvasTexture {
  const c = makeCanvas(256, 128);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#c81e1e';
  ctx.lineWidth = 3;
  for (const cx of [64, 192]) {
    ctx.beginPath();
    ctx.ellipse(cx, 64, 34, 58, 0, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const x = cx + Math.cos(a) * 34;
      const y = 64 + Math.sin(a) * 58;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 3);
      ctx.lineTo(x + 4, y + 3);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const themeFor = (id: string): Theme => THEMES[id] ?? THEMES.classic;

const makeCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number, scale = 1): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 255 * alpha * scale;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

export function createWoodTexture(base: string, dark: string): THREE.CanvasTexture {
  const w = 512;
  const h = 512;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * h;
    ctx.strokeStyle = dark;
    ctx.globalAlpha = 0.08 + Math.random() * 0.12;
    ctx.lineWidth = 1 + Math.random() * 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 6 + (Math.random() - 0.5) * 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  noise(ctx, w, h, 0.06);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Metal-flake lacquer for the All-Star cabinet: deep gradient with sparkles. */
export function createLacquerTexture(base: string, dark: string): THREE.CanvasTexture {
  const w = 256;
  const h = 256;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, base);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rnd = seeded(7);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.08 + rnd() * 0.25})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Small deterministic PRNG so regenerated art never shifts between theme swaps. */
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

/** Decorative chaser lamps on the lower playfield (table coords): outlanes, inlanes and the arc over the medallion. */
export const CHASER_LAMPS: Array<{ x: number; y: number; group: number }> = (() => {
  const out: Array<{ x: number; y: number; group: number }> = [];
  for (const y of [6.8, 7.9, 9.0, 10.1, 11.2]) out.push({ x: 0.9, y, group: 0 }, { x: 19.3, y, group: 0 });
  for (const y of [9.9, 10.9, 11.9]) out.push({ x: 2.7, y, group: 1 }, { x: 17.5, y, group: 1 });
  for (let i = 0; i < 9; i++) {
    const a = ((20 + (140 * i) / 8) * Math.PI) / 180;
    out.push({ x: 10.1 + Math.cos(a) * 3.55, y: 8.3 + Math.sin(a) * 3.55, group: 2 });
  }
  return out;
})();

export function createMetalTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 256;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#b9bcc2';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) {
    ctx.strokeStyle = Math.random() > 0.5 ? '#d8dbe0' : '#9a9da3';
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    const y = Math.random() * h;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y + (Math.random() - 0.5) * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createParticleTexture(): THREE.CanvasTexture {
  const c = makeCanvas(64, 64);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createCrowdTexture(): THREE.CanvasTexture {
  // Rows of tiny crowd silhouettes for the far stands.
  const w = 1024;
  const h = 128;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1a2440';
  ctx.fillRect(0, 0, w, h);
  const palette = ['#e8e3d4', '#d64545', '#2c7be5', '#f5c542', '#8fd0ff', '#f2a65a', '#ffffff', '#4bc26b'];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 160; i++) {
      const x = i * 6.4 + (row % 2) * 3 + (Math.random() - 0.5) * 2;
      const y = 28 + row * 26 + (Math.random() - 0.5) * 4;
      ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)];
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - 3, y + 2, 6, 10);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createBannerTexture(theme: Theme): THREE.CanvasTexture {
  const w = 2048;
  const h = 128;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const ads: Array<[string, string, string]> = [
    ['DIAMOND PINBALL', '#0d1a45', '#f3ead3'],
    ['SLUGGER COLA', '#a3161c', '#ffffff'],
    ['HOME RUN HOTEL', '#0d2a1f', '#f4b942'],
    ['PEANUTS · CRACKER JACK', '#f3ead3', '#a3161c'],
    ['BIG LEAGUE CHEW', '#0d1a45', '#ffffff'],
    ['BLEACHER CREATURES', '#1a1a1a', '#f4b942'],
    ['DOUBLE PLAY DINER', '#a3161c', '#f3ead3'],
    ['410 FT', '#0d2a1f', '#ffffff'],
  ];
  const segW = w / ads.length;
  ads.forEach(([text, bg, fg], i) => {
    ctx.fillStyle = bg;
    ctx.fillRect(i * segW, 0, segW, h);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(i * segW, 0, segW, h * 0.45);
    ctx.fillStyle = fg;
    ctx.font = `600 52px ${DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, i * segW + segW / 2, h / 2 + 2, segW - 24);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(i * segW, 0, 3, h);
  });
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, 0, w, 6);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ----------------------------------------------------------------------------
// Playfield art
//
// Painted like a real night-game field under a clear-coat: mowed turf, raked
// clay, crisp chalk, field-paint lettering, and contact shadows baked from the
// actual table geometry so every wall, post and bumper sits *on* the field.

export function createPlayfieldTexture(def: TableDef, theme: Theme, W = 1024): THREE.CanvasTexture {
  const H = Math.round((W * TABLE.length) / TABLE.width);
  const S = W / TABLE.width;
  const X = (x: number) => x * S;
  const Y = (y: number) => (TABLE.length - y) * S;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const rnd = seeded(11);
  const trim = theme.trim ?? '#d2232a';
  const d = def.diamond;
  const apronY = 13.0;

  // ---- Turf: base colour, broad lighting variation, diamond-cut mowing.
  ctx.fillStyle = theme.grass[0];
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    const gx = X(rnd() * 22);
    const gy = Y(13 + rnd() * 31);
    const r = (2 + rnd() * 5) * S;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
    const tone = rnd() > 0.5 ? '255,255,220' : '0,20,0';
    g.addColorStop(0, `rgba(${tone},0.05)`);
    g.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
  }
  const mow = (angle: number, color: string) => {
    ctx.save();
    ctx.translate(X(d.home.x), Y(d.home.y));
    ctx.rotate(angle);
    ctx.fillStyle = color;
    const band = 1.7 * S;
    for (let k = -30; k < 30; k += 2) ctx.fillRect(k * band, -60 * S, band, 120 * S);
    ctx.restore();
  };
  mow(Math.PI / 4, 'rgba(255,255,235,0.055)');
  mow(-Math.PI / 4, 'rgba(0,18,4,0.07)');
  // Turf fibres: short strokes of light and dark green.
  ctx.lineWidth = Math.max(1, 0.03 * S);
  ctx.lineCap = 'round';
  const fibres = Math.round((W * H) / 900);
  for (let i = 0; i < fibres; i++) {
    const fx = rnd() * W;
    const fy = rnd() * H;
    const len = (0.05 + rnd() * 0.08) * S;
    ctx.strokeStyle = rnd() > 0.5 ? 'rgba(190,255,170,0.07)' : 'rgba(0,30,8,0.09)';
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + (rnd() - 0.5) * len * 0.5, fy - len);
    ctx.stroke();
  }

  // ---- Clay: warning track, infield, mound and home plate circle.
  const clay = (paint: () => void, speckles: number) => {
    ctx.save();
    ctx.beginPath();
    paint();
    ctx.clip();
    ctx.fillStyle = theme.dirt;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < speckles; i++) {
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,225,190,0.16)' : 'rgba(60,20,5,0.18)';
      const r = (0.015 + rnd() * 0.035) * S;
      ctx.fillRect(rnd() * W, Y(13 + rnd() * 31), r, r);
    }
    ctx.restore();
  };
  const arc = () => ctx.arc(X(TABLE.arcCenter.x), Y(TABLE.arcCenter.y), TABLE.arcRadius * S, Math.PI, 0);
  // Warning track: a band of darker clay inside the fence.
  ctx.save();
  ctx.beginPath();
  arc();
  ctx.lineTo(X(22), Y(33));
  ctx.lineTo(X(0), Y(33));
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = shade(theme.dirt, -0.28);
  ctx.lineWidth = 1.5 * S;
  ctx.beginPath();
  ctx.arc(X(TABLE.arcCenter.x), Y(TABLE.arcCenter.y), (TABLE.arcRadius - 0.75) * S, Math.PI, 0);
  ctx.stroke();
  ctx.restore();
  // Infield skin: one dirt circle, then the infield grass cut back in.
  const dirtR = 7.2 * S;
  const dirtCx = X(d.mound.x);
  const dirtCy = Y(d.mound.y) + 0.3 * S;
  clay(() => ctx.arc(dirtCx, dirtCy, dirtR, 0, Math.PI * 2), Math.round(W * 4));
  ctx.save();
  ctx.beginPath();
  ctx.arc(dirtCx, dirtCy, dirtR, 0, Math.PI * 2);
  ctx.clip();
  // Rake lines circle the mound; the skin is lighter where the lights hit it.
  const lit = ctx.createRadialGradient(dirtCx, dirtCy - 2 * S, 0, dirtCx, dirtCy, dirtR);
  lit.addColorStop(0, 'rgba(255,220,170,0.18)');
  lit.addColorStop(1, 'rgba(40,10,0,0.18)');
  ctx.fillStyle = lit;
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 0.05 * S;
  for (let r = 1.6; r < 7.2; r += 0.32) {
    ctx.strokeStyle = r % 0.64 < 0.32 ? 'rgba(255,230,200,0.07)' : 'rgba(50,15,0,0.08)';
    ctx.beginPath();
    ctx.arc(dirtCx, dirtCy, r * S, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  // Infield grass (with the lip where grass meets clay).
  const infield = () => {
    ctx.beginPath();
    ctx.moveTo(X(d.home.x), Y(d.home.y + 0.9));
    ctx.lineTo(X(d.first.x - 0.9), Y(d.first.y));
    ctx.lineTo(X(d.second.x), Y(d.second.y - 0.9));
    ctx.lineTo(X(d.third.x + 0.9), Y(d.third.y));
    ctx.closePath();
  };
  ctx.save();
  infield();
  ctx.clip();
  ctx.fillStyle = theme.grass[1];
  ctx.fillRect(0, 0, W, H);
  mow(0, 'rgba(255,255,235,0.05)');
  ctx.restore();
  infield();
  ctx.strokeStyle = 'rgba(20,10,0,0.35)';
  ctx.lineWidth = 0.08 * S;
  ctx.stroke();
  // Base paths, mound and the home plate circle.
  ctx.save();
  ctx.strokeStyle = shade(theme.dirt, 0.04);
  ctx.lineWidth = 1.1 * S;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(X(d.home.x), Y(d.home.y));
  ctx.lineTo(X(d.first.x), Y(d.first.y));
  ctx.lineTo(X(d.second.x), Y(d.second.y));
  ctx.lineTo(X(d.third.x), Y(d.third.y));
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
  for (const [p, r] of [[d.mound, 1.1], [d.home, 1.6]] as const) {
    const g = ctx.createRadialGradient(X(p.x), Y(p.y), 0, X(p.x), Y(p.y), r * S);
    g.addColorStop(0, shade(theme.dirt, 0.12));
    g.addColorStop(1, theme.dirt);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), r * S, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Chalk: foul lines to the fence, batter's boxes, on-deck circle.
  ctx.save();
  ctx.strokeStyle = 'rgba(250,250,240,0.92)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.12 * S;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(X(d.home.x), Y(d.home.y));
    ctx.lineTo(X(d.home.x + side * 10.4), Y(d.home.y + 10.4));
  }
  ctx.stroke();
  ctx.lineWidth = 0.08 * S;
  ctx.strokeRect(X(d.home.x + 0.55), Y(d.home.y + 0.7), 0.6 * S, 1.4 * S);
  ctx.strokeRect(X(d.home.x - 1.15), Y(d.home.y + 0.7), 0.6 * S, 1.4 * S);
  ctx.beginPath();
  ctx.arc(X(d.onDeck.x), Y(d.onDeck.y), 0.45 * S, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // ---- Apron: navy enamel with gold pinstripes, a light pool behind the crest.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, Y(apronY), W, H - Y(apronY));
  ctx.clip();
  const apron = ctx.createLinearGradient(0, Y(apronY), 0, H);
  apron.addColorStop(0, shade(theme.apron, 0.1));
  apron.addColorStop(1, shade(theme.apron, -0.45));
  ctx.fillStyle = apron;
  ctx.fillRect(0, Y(apronY), W, H - Y(apronY));
  ctx.strokeStyle = hexA(theme.accent, 0.12);
  ctx.lineWidth = Math.max(1, 0.03 * S);
  for (let x = 0.3; x < 20.2; x += 0.55) {
    ctx.beginPath();
    ctx.moveTo(X(x), Y(apronY));
    ctx.lineTo(X(x), H);
    ctx.stroke();
  }
  const pool = ctx.createRadialGradient(X(10.1), Y(8.3), 0, X(10.1), Y(8.3), 7 * S);
  pool.addColorStop(0, 'rgba(255,214,140,0.30)');
  pool.addColorStop(0.5, 'rgba(255,190,110,0.10)');
  pool.addColorStop(1, 'rgba(255,190,110,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, Y(apronY), W, H - Y(apronY));
  // Pinstriped outlanes: the home uniform.
  for (const [x0, x1] of [[0, 1.8], [18.4, 20.2]]) {
    ctx.fillStyle = '#efe6cf';
    ctx.fillRect(X(x0), Y(12.6), (x1 - x0) * S, Y(0) - Y(12.6));
    ctx.strokeStyle = 'rgba(16,36,96,0.6)';
    ctx.lineWidth = 0.045 * S;
    for (let x = x0 + 0.22; x < x1; x += 0.36) {
      ctx.beginPath();
      ctx.moveTo(X(x), Y(12.6));
      ctx.lineTo(X(x), Y(0));
      ctx.stroke();
    }
    ctx.fillStyle = trim;
    ctx.fillRect(X(x0), Y(12.6), (x1 - x0) * S, 0.14 * S);
  }
  ctx.restore();
  // Gold rule with a red pinline where the field meets the apron.
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, Y(apronY) - 0.08 * S, W, 0.16 * S);
  ctx.fillStyle = trim;
  ctx.fillRect(0, Y(apronY) + 0.12 * S, W, 0.05 * S);

  // ---- Launch lane: gunmetal diamond plate.
  ctx.save();
  ctx.beginPath();
  ctx.rect(X(20.2), Y(32), 1.8 * S, Y(0) - Y(32));
  ctx.clip();
  ctx.fillStyle = '#20232b';
  ctx.fillRect(X(20.2), Y(32), 1.8 * S, Y(0) - Y(32));
  for (let y = 0; y < 32; y += 0.42) {
    for (let x = 20.2 + ((y / 0.42) % 2) * 0.21; x < 22; x += 0.42) {
      ctx.save();
      ctx.translate(X(x), Y(y));
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(-0.12 * S, -0.03 * S, 0.24 * S, 0.06 * S);
      ctx.restore();
    }
  }
  ctx.restore();

  // ---- Baked contact shadows from the real geometry. Light comes from the back right,
  //      so shadows fall left and toward the player.
  const castShadow = (paint: () => void, mode: 'fill' | 'stroke', width: number, blur: number, alpha: number, off: number) => {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${alpha})`;
    ctx.shadowBlur = blur * S;
    ctx.shadowOffsetX = W * 3 - off * S;
    ctx.shadowOffsetY = off * S * 0.8;
    ctx.translate(-W * 3, 0);
    ctx.beginPath();
    paint();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width * S;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
    if (mode === 'fill') ctx.fill();
    else ctx.stroke();
    ctx.restore();
  };
  const wallsPath = (styles: string[]) => () => {
    for (const w of def.walls) {
      if (w.id === 'outer_arc' || !styles.includes(w.style)) continue;
      w.points.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
    }
  };
  const solids = () => {
    for (const p of def.posts) {
      ctx.moveTo(X(p.pos.x) + p.radius * S, Y(p.pos.y));
      ctx.arc(X(p.pos.x), Y(p.pos.y), p.radius * S, 0, Math.PI * 2);
    }
    for (const b of def.bumpers) {
      ctx.moveTo(X(b.pos.x) + b.radius * 1.05 * S, Y(b.pos.y));
      ctx.arc(X(b.pos.x), Y(b.pos.y), b.radius * 1.05 * S, 0, Math.PI * 2);
    }
    for (const s of def.slingshots) {
      s.points.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.closePath();
    }
  };
  const targetsPath = () => {
    for (const t of def.targets) {
      ctx.moveTo(X(t.a.x), Y(t.a.y));
      ctx.lineTo(X(t.b.x), Y(t.b.y));
    }
  };
  // Ramps throw broad, soft shadows that drift further the higher the ramp rides.
  // Segments are batched into height bands: one blurred draw per band keeps generation fast on phones.
  for (const [lo, hi] of [[0.5, 2], [2, 4], [4, 99]] as const) {
    castShadow(() => {
      for (const ramp of def.ramps) {
        for (let i = 1; i < ramp.path.length; i++) {
          const a = ramp.path[i - 1];
          const b = ramp.path[i];
          const h = (a.h + b.h) / 2;
          if (h < lo || h >= hi) continue;
          ctx.moveTo(X(a.x), Y(a.y));
          ctx.lineTo(X(b.x), Y(b.y));
        }
      }
    }, 'stroke', 1.1, 0.8, 0.28, 0.25 + Math.min(hi, 6) * 0.12);
  }
  // Fence: the padded wall shades the warning track.
  castShadow(() => ctx.arc(X(TABLE.arcCenter.x), Y(TABLE.arcCenter.y), (TABLE.arcRadius + 0.2) * S, Math.PI, 0), 'stroke', 0.6, 0.7, 0.55, 0.2);
  for (const [blur, alpha, off] of [[0.55, 0.42, 0.34], [0.12, 0.6, 0.06]] as const) {
    castShadow(wallsPath(['wood', 'plastic', 'fence', 'rubber']), 'stroke', 0.45, blur, alpha, off);
    castShadow(wallsPath(['metal']), 'stroke', 0.2, blur, alpha * 0.8, off);
    castShadow(solids, 'fill', 0, blur, alpha, off);
    castShadow(targetsPath, 'stroke', 0.3, blur, alpha * 0.9, off);
  }

  // ---- Field paint: lane lettering and chevrons, outlined like stencilled signage.
  const paint = (text: string, x: number, y: number, size = 0.55, color = '#f6efdc', angle = 0) => {
    ctx.save();
    ctx.translate(X(x), Y(y));
    ctx.rotate(angle);
    ctx.font = `600 ${size * S}px ${DISPLAY}`;
    try {
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${size * S * 0.06}px`;
    } catch {
      /* older canvases ignore letter spacing */
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(6,10,24,0.85)';
    ctx.lineWidth = size * S * 0.2;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  const chevrons = (x: number, y: number, color: string, angle = 0) => {
    ctx.save();
    ctx.translate(X(x), Y(y));
    ctx.rotate(angle);
    for (let i = 0; i < 3; i++) {
      const yy = -i * 0.5 * S;
      ctx.beginPath();
      ctx.moveTo(-0.42 * S, yy + 0.2 * S);
      ctx.lineTo(0, yy - 0.22 * S);
      ctx.lineTo(0.42 * S, yy + 0.2 * S);
      ctx.lineTo(0, yy - 0.02 * S);
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(6,10,24,0.85)';
      ctx.lineWidth = 0.08 * S;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.globalAlpha = 1 - i * 0.22;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };
  chevrons(4.5, 21.0, theme.accent2);
  paint('LEFT FIELD', 4.5, 19.9, 0.46);
  chevrons(15.7, 21.0, '#ff8a3b');
  paint('RIGHT FIELD', 15.7, 19.9, 0.46);
  chevrons(10.1, 22.2, '#ffe07a');
  paint('2B POWER', 10.1, 20.3, 0.42, '#ffe07a');
  paint('HOME RUN', 1.3, 27.8, 0.42, '#ff7a7a', -Math.PI / 2);
  chevrons(1.3, 24.9, '#ff6b6b');
  paint('DUGOUT', 18.7, 25.4, 0.4, '#e2c6ff');
  chevrons(18.7, 23.3, '#c77dff');
  paint('BALL', 2.0, 40.4, 0.34);
  paint('STRIKE', 4.5, 40.4, 0.34);
  paint('OUT', 6.7, 40.4, 0.34);
  paint('KICKBACK', 0.9, 7.6, 0.3, '#bdf0ff', -Math.PI / 2);
  paint('LF', 3.4, 13.6, 0.4, theme.accent);
  paint('RF', 16.8, 13.6, 0.4, theme.accent);
  paint('3B', 7.45, 22.5, 0.5);
  paint('1B', 12.75, 22.5, 0.5);
  paint('LOCK', 18.7, 27.3, 0.36, '#e2c6ff');
  paint('SANDLOT', 4.5, 21.75, 0.26, '#7dffb9');
  paint('REACTOR', 10.1, 29.45, 0.3, '#7ffff6');
  // Distance markers on the warning track.
  for (const sec of def.wallSections) paint(sec.marker, sec.pos.x, sec.pos.y - 0.9, 0.42, '#f6efdc');

  // ---- Apron crest: crossed bats, a stitched ball and the jersey script.
  crest(ctx, X(10.1), Y(8.3), S, theme, trim);

  // ---- Lamp bezels: a shadowed well and a chrome ring around every insert.
  const bezel = (x: number, y: number, r: number) => {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(X(x), Y(y), (r + 0.12) * S, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createLinearGradient(X(x), Y(y) - r * S, X(x), Y(y) + r * S);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#9aa2b0');
    g.addColorStop(1, '#e8ecf2');
    ctx.strokeStyle = g;
    ctx.lineWidth = 0.07 * S;
    ctx.beginPath();
    ctx.arc(X(x), Y(y), (r + 0.05) * S, 0, Math.PI * 2);
    ctx.stroke();
  };
  for (const lamp of def.lamps) bezel(lamp.pos.x, lamp.pos.y, 0.36);
  for (const cl of CHASER_LAMPS) bezel(cl.x, cl.y, 0.26);

  // ---- Baked lighting: the field glows under the stadium lights, the edges fall off.
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  const glow = ctx.createRadialGradient(X(10.6), Y(26), 0, X(10.6), Y(26), 16 * S);
  glow.addColorStop(0, 'rgba(255,240,210,0.55)');
  glow.addColorStop(1, 'rgba(255,240,210,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  for (const [x0, dir] of [[0, 1], [W, -1]] as const) {
    const edge = ctx.createLinearGradient(x0, 0, x0 + dir * 2.4 * S, 0);
    edge.addColorStop(0, 'rgba(0,0,0,0.38)');
    edge.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
  }
  noise(ctx, W, H, 0.03);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const hexA = (hex: string, a: number): string => {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
};

/** Lighten (k > 0) or darken (k < 0) a CSS hex colour. */
const shade = (hex: string, k: number): string => {
  const c = new THREE.Color(hex);
  const t = k > 0 ? new THREE.Color(1, 1, 1) : new THREE.Color(0, 0, 0);
  c.lerp(t, Math.abs(k));
  return `#${c.getHexString()}`;
};

/** The apron crest: crossed maple bats behind a stitched ball, the jersey script across it. */
function crest(ctx: CanvasRenderingContext2D, cx: number, cy: number, S: number, theme: Theme, trim: string): void {
  const navy = '#0d1a45';
  const R = 2.35 * S;
  ctx.save();
  ctx.translate(cx, cy);
  // Crossed bats (behind the ball).
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.rotate(side * 0.7);
    const L = 7.6 * S;
    ctx.translate(0, 0.2 * S);
    ctx.beginPath();
    ctx.moveTo(-0.11 * S, L * 0.5);
    ctx.quadraticCurveTo(-0.12 * S, 0, -0.3 * S, -L * 0.32);
    ctx.quadraticCurveTo(-0.32 * S, -L * 0.5, 0, -L * 0.5);
    ctx.quadraticCurveTo(0.32 * S, -L * 0.5, 0.3 * S, -L * 0.32);
    ctx.quadraticCurveTo(0.12 * S, 0, 0.11 * S, L * 0.5);
    ctx.closePath();
    const wood = ctx.createLinearGradient(-0.3 * S, 0, 0.3 * S, 0);
    wood.addColorStop(0, '#9a6a35');
    wood.addColorStop(0.45, '#f0cf98');
    wood.addColorStop(1, '#a8743c');
    ctx.fillStyle = wood;
    ctx.strokeStyle = navy;
    ctx.lineWidth = 0.08 * S;
    ctx.fill();
    ctx.stroke();
    // Knob and grip tape.
    ctx.fillStyle = navy;
    ctx.beginPath();
    ctx.ellipse(0, L * 0.5, 0.2 * S, 0.09 * S, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(13,26,69,0.85)';
    ctx.lineWidth = 0.05 * S;
    for (let k = 0; k < 6; k++) {
      const y = L * 0.46 - k * 0.16 * S;
      ctx.beginPath();
      ctx.moveTo(-0.12 * S, y);
      ctx.lineTo(0.12 * S, y - 0.08 * S);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Gold and red rings, then the ball with real shading.
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(0, 0, R + 0.24 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = navy;
  ctx.beginPath();
  ctx.arc(0, 0, R + 0.12 * S, 0, Math.PI * 2);
  ctx.fill();
  const ball = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.05, 0, 0, R);
  ball.addColorStop(0, '#fffdf6');
  ball.addColorStop(0.7, '#ece4cf');
  ball.addColorStop(1, '#b9ad91');
  ctx.fillStyle = ball;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d0232a';
  for (const side of [-1, 1]) {
    const ox = side * R * 1.45;
    const mid = side > 0 ? Math.PI : 0;
    ctx.lineWidth = 0.08 * S;
    ctx.beginPath();
    ctx.arc(ox, 0, R * 0.95, mid - 0.95, mid + 0.95);
    ctx.stroke();
    ctx.lineWidth = 0.045 * S;
    for (let i = -6; i <= 6; i++) {
      const a = mid + (i / 6) * 0.9;
      const px = ox + Math.cos(a) * R * 0.95;
      const py = Math.sin(a) * R * 0.95;
      ctx.beginPath();
      ctx.moveTo(px - 0.12 * S, py - 0.07 * S);
      ctx.lineTo(px + 0.12 * S, py + 0.07 * S);
      ctx.stroke();
    }
  }
  // Jersey script across the ball, with the classic tail swash underneath.
  ctx.save();
  ctx.rotate(-0.12);
  ctx.font = `${1.55 * S}px ${SCRIPT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = navy;
  ctx.lineWidth = 0.34 * S;
  ctx.strokeText('Diamond', 0, -0.15 * S);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.14 * S;
  ctx.strokeText('Diamond', 0, -0.15 * S);
  ctx.fillStyle = trim;
  ctx.fillText('Diamond', 0, -0.15 * S);
  ctx.beginPath();
  ctx.moveTo(-1.6 * S, 0.62 * S);
  ctx.quadraticCurveTo(0.6 * S, 0.95 * S, 2.6 * S, 0.25 * S);
  ctx.lineCap = 'round';
  ctx.strokeStyle = navy;
  ctx.lineWidth = 0.3 * S;
  ctx.stroke();
  ctx.strokeStyle = trim;
  ctx.lineWidth = 0.14 * S;
  ctx.stroke();
  ctx.restore();
  // Ribbon banner: PINBALL in varsity caps.
  const bw = 3.6 * S;
  const bh = 0.68 * S;
  const by = R * 0.72;
  ctx.fillStyle = shade(trim, -0.35);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * bw * 0.82, by - bh * 0.1);
    ctx.lineTo(side * bw * 1.1, by - bh * 0.1);
    ctx.lineTo(side * bw * 0.98, by + bh * 0.5);
    ctx.lineTo(side * bw * 1.1, by + bh * 1.1);
    ctx.lineTo(side * bw * 0.82, by + bh * 1.1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = navy;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 0.08 * S;
  ctx.beginPath();
  ctx.rect(-bw * 0.9, by - bh * 0.42, bw * 1.8, bh * 1.3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f6efdc';
  ctx.font = `700 ${0.6 * S}px ${DISPLAY}`;
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${0.18 * S}px`;
  } catch {
    /* ignore */
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PINBALL', 0.09 * S, by + bh * 0.24);
  ctx.restore();
}

/** A night sky ringed by distant stadium light towers: low contrast so the machine stays the hero. */
export function createNightBackdrop(): THREE.CanvasTexture {
  const w = 2048;
  const h = 512;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#03040c');
  g.addColorStop(0.5, '#0a1030');
  g.addColorStop(0.68, '#1a1a3c');
  g.addColorStop(0.8, '#0b0d22');
  g.addColorStop(1, '#05060f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rnd = seeded(3);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(220,230,255,${0.15 + rnd() * 0.5})`;
    const s = rnd() > 0.92 ? 2 : 1;
    ctx.fillRect(rnd() * w, rnd() * h * 0.5, s, s);
  }
  // Distant ballpark: a dark bowl silhouette with light towers and their halos.
  ctx.fillStyle = '#070816';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.8);
  for (let x = 0; x <= w; x += 32) ctx.lineTo(x, h * (0.74 + Math.sin(x * 0.004) * 0.025 + rnd() * 0.01));
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.fill();
  for (let i = 0; i < 8; i++) {
    const x = (i + 0.5) * (w / 8) + (rnd() - 0.5) * 60;
    const top = h * (0.5 + rnd() * 0.06);
    ctx.strokeStyle = '#0c0e1e';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.78);
    ctx.lineTo(x, top);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(x, top, 0, x, top, 70);
    halo.addColorStop(0, 'rgba(230,236,255,0.55)');
    halo.addColorStop(0.2, 'rgba(180,200,255,0.18)');
    halo.addColorStop(1, 'rgba(120,140,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(x - 70, top - 70, 140, 140);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(x - 10, top - 4, 20, 8);
    ctx.globalCompositeOperation = 'source-over';
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dark polished arena floor with a faint tile grid. */
export function createArenaFloor(): THREE.CanvasTexture {
  const w = 256;
  const c = makeCanvas(w, w);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0a0c16';
  ctx.fillRect(0, 0, w, w);
  noise(ctx, w, w, 0.04);
  ctx.strokeStyle = 'rgba(140,160,220,0.05)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, w - 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 24);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Lamp insert: faceted coloured glass (multiplied by the lamp colour). */
export function createInsertTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s * 0.42, s * 0.38, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.55, '#d8d8d8');
  g.addColorStop(1, '#7a7a7a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 2;
  for (let r = 10; r < s / 2; r += 9) {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.ellipse(s * 0.38, s * 0.3, s * 0.16, s * 0.07, -0.5, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Hot spark: a bright core with a four-point glint. */
export function createSparkTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[30, 2.2], [2.2, 30]]) {
    const lg = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    lg.addColorStop(0, 'rgba(255,255,255,0.9)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(32 - w, 32 - h, w * 2, h * 2);
  }
  return new THREE.CanvasTexture(c);
}

/** Confetti chip: a small shaded paper square. */
export function createConfettiTexture(): THREE.CanvasTexture {
  const s = 32;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d')!;
  ctx.translate(16, 16);
  ctx.rotate(0.5);
  const g = ctx.createLinearGradient(-9, -6, 9, 6);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#9a9a9a');
  ctx.fillStyle = g;
  ctx.fillRect(-10, -6, 20, 12);
  return new THREE.CanvasTexture(c);
}

/** Shockwave ring for impacts (white, tinted per use). */
export function createRingTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.62, 'rgba(255,255,255,0)');
  g.addColorStop(0.8, 'rgba(255,255,255,1)');
  g.addColorStop(0.88, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

/** A soft beam of stadium light (vertical alpha falloff, white). */
export function createBeamTexture(): THREE.CanvasTexture {
  const c = makeCanvas(64, 256);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}

// ----------------------------------------------------------------------------
// Backglass scoreboard: a ballpark board, green enamel, cream lettering, amber bulbs.

export interface ScoreboardData {
  baseball: BaseballState;
  pinballScore: number;
  message: string;
  ballsLeft: number;
  multiplier: number;
}

export interface Scoreboard {
  texture: THREE.CanvasTexture;
  update(data: ScoreboardData): void;
}

const CREAM = '#f3ead3';
const AMBER = '#ffb52e';

export function createScoreboard(theme: Theme): Scoreboard {
  const W = 1024;
  const H = 512;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const rnd = seeded(21);
  // Static board: enamel, panel seams and rivets, cream double frame. Drawn once.
  const board = makeCanvas(W, H);
  {
    const b = board.getContext('2d')!;
    const g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#12382a');
    g.addColorStop(1, '#081d15');
    b.fillStyle = g;
    b.fillRect(0, 0, W, H);
    b.strokeStyle = 'rgba(0,0,0,0.35)';
    b.lineWidth = 2;
    for (let x = 128; x < W; x += 128) {
      b.beginPath();
      b.moveTo(x, 0);
      b.lineTo(x, H);
      b.stroke();
    }
    for (let x = 128; x < W; x += 128)
      for (let y = 26; y < H; y += 92) {
        b.fillStyle = 'rgba(255,255,255,0.12)';
        b.beginPath();
        b.arc(x + 6, y, 2.5, 0, Math.PI * 2);
        b.fill();
      }
    noise(b, W, H, 0.04);
    b.strokeStyle = CREAM;
    b.lineWidth = 6;
    b.strokeRect(12, 12, W - 24, H - 24);
    b.strokeStyle = hexA(CREAM, 0.5);
    b.lineWidth = 2;
    b.strokeRect(24, 24, W - 48, H - 48);
    void rnd;
  }
  const text = (s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 600, font = DISPLAY) => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  };
  const inset = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = '#04100b';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  };
  const glowText = (s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign) => {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    text(s, x, y, size, color, align, 700);
    ctx.restore();
  };
  const bulb = (x: number, y: number, on: boolean, color: string) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    if (on) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = color;
    } else ctx.fillStyle = '#1d2a24';
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  const update = (data: ScoreboardData) => {
    const s = data.baseball;
    ctx.drawImage(board, 0, 0);
    ctx.textBaseline = 'middle';
    // Header: the script wordmark and the pinball score in amber.
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.font = `68px ${SCRIPT}`;
    ctx.textAlign = 'left';
    ctx.strokeStyle = '#06140e';
    ctx.lineWidth = 12;
    ctx.strokeText('Diamond Pinball', 46, 74);
    ctx.fillStyle = CREAM;
    ctx.fillText('Diamond Pinball', 46, 74);
    ctx.restore();
    inset(W - 404, 38, 362, 72);
    glowText(data.pinballScore.toLocaleString('en-US'), W - 56, 75, 54, AMBER, 'right');

    // Line score: cream headers, numbers in black inset cells.
    const innings = Math.min(Math.max(s.totalInnings, s.inning), 9);
    const x0 = 46;
    const nameW = 250;
    const cols = innings + 3;
    const colW = (W - 92 - nameW) / cols;
    const y0 = 150;
    const rowH = 58;
    const headers: string[] = [];
    for (let i = 1; i <= innings; i++) headers.push(String(i));
    headers.push('R', 'H', 'E');
    headers.forEach((h, i) => text(h, x0 + nameW + colW * i + colW / 2, y0, 26, i >= innings ? AMBER : CREAM, 'center', 600));
    const drawRow = (side: 'away' | 'home', y: number) => {
      const line = s[side];
      const batting = (s.half === 'top') === (side === 'away') && !s.gameOver;
      text(TEAM_NAMES[side] + (side === PLAYER_SIDE ? ' ★' : ''), x0 + 22, y, 32, batting ? AMBER : CREAM, 'left', 700);
      if (batting) {
        ctx.fillStyle = AMBER;
        ctx.beginPath();
        ctx.moveTo(x0, y - 9);
        ctx.lineTo(x0 + 13, y);
        ctx.lineTo(x0, y + 9);
        ctx.fill();
      }
      for (let i = 0; i < cols; i++) {
        const cx = x0 + nameW + colW * i;
        inset(cx + 4, y - 24, colW - 8, 48);
        let v: string;
        if (i < innings) v = line.innings[i] === undefined ? '' : String(line.innings[i]);
        else v = String([line.runs, line.hits, line.errors][i - innings]);
        if (i >= innings) glowText(v, cx + colW / 2, y + 2, 32, i === innings ? AMBER : CREAM, 'center');
        else text(v, cx + colW / 2, y + 2, 32, CREAM, 'center', 700);
      }
    };
    drawRow('away', y0 + rowH);
    drawRow('home', y0 + rowH * 2);

    // Situation: inning, ball/strike/out bulbs and the bases.
    const sy = 352;
    text(s.gameOver ? 'FINAL' : `${s.half === 'top' ? '▲' : '▼'} ${s.inning}`, x0 + 6, sy, 40, CREAM, 'left', 700);
    const lights: Array<[string, number, number, string]> = [
      ['BALL', s.balls, 3, '#7cff8a'],
      ['STRIKE', s.strikes, 2, AMBER],
      ['OUT', s.outs, 2, '#ff4a3d'],
    ];
    let lx = x0 + 150;
    for (const [label, n, max, col] of lights) {
      text(label, lx, sy, 22, hexA(CREAM, 0.8), 'left', 500);
      ctx.font = `500 22px ${DISPLAY}`;
      const lw = ctx.measureText(label).width + 22;
      for (let i = 0; i < max; i++) bulb(lx + lw + i * 28, sy, i < n, col);
      lx += lw + max * 28 + 30;
    }
    const bx = W - 120;
    const drawBase = (dx: number, dy: number, on: boolean) => {
      ctx.save();
      ctx.translate(bx + dx, sy + dy);
      ctx.rotate(Math.PI / 4);
      if (on) {
        ctx.shadowColor = AMBER;
        ctx.shadowBlur = 16;
      }
      ctx.fillStyle = on ? AMBER : '#1d2a24';
      ctx.fillRect(-12, -12, 24, 24);
      ctx.restore();
    };
    drawBase(30, 0, !!s.bases[0]);
    drawBase(0, -30, !!s.bases[1]);
    drawBase(-30, 0, !!s.bases[2]);
    text(`BALL ${Math.max(1, 4 - data.ballsLeft)}`, bx - 64, sy + 4, 24, hexA(CREAM, 0.8), 'right', 500);
    if (data.multiplier > 1) glowText(`×${data.multiplier}`, bx - 64, sy - 26, 24, AMBER, 'right');

    // Message board: amber lamp lettering on black.
    inset(46, 404, W - 92, 76);
    ctx.save();
    try {
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '4px';
    } catch {
      /* ignore */
    }
    glowText(data.message.toUpperCase(), W / 2, 444, 44, AMBER, 'center');
    ctx.restore();
    void theme;
    texture.needsUpdate = true;
  };

  return { texture, update };
}
