import * as THREE from 'three';
import type { BaseballState } from '../baseball/types';
import { TABLE, type TableDef } from '../table/layout';
import { PLAYER_SIDE, TEAM_NAMES } from '../game/Game';

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
  classic: { id: 'classic', name: 'All-Star', cabinet: '#1d4fc4', cabinetDark: '#0b2470', rail: 0xe4e8ef, railMetalness: 1, accent: '#ffd23f', accent2: '#3f8cff', grass: ['#36a84a', '#2c9440'], dirt: '#d9803c', apron: '#1a43b0', glow: 0x6fb6ff, trim: '#e0262b', lacquer: true },
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
  const ads = ['DIAMOND PINBALL', 'SLUGGER COLA', 'HOME RUN HOTEL', 'PEANUTS & CRACKER JACK', 'BIG LEAGUE CHEW', 'BLEACHER CREATURE', 'DOUBLE PLAY DINER', '410 FT'];
  const colors = ['#1f3b73', '#b8322f', '#1d6b3a', '#f5c542', '#2c7be5', '#2a2a2a', '#8c3fa1', '#1f3b73'];
  const segW = w / ads.length;
  ads.forEach((text, i) => {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(i * segW, 0, segW, h);
    ctx.fillStyle = i % 4 === 3 ? '#1a1a1a' : '#ffffff';
    ctx.font = 'bold 44px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, i * segW + segW / 2, h / 2 + 2);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 6;
    ctx.strokeRect(i * segW + 3, 3, segW - 6, h - 6);
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ----------------------------------------------------------------------------
// Playfield art

export function createPlayfieldTexture(def: TableDef, theme: Theme): THREE.CanvasTexture {
  const W = 1024;
  const H = Math.round((W * TABLE.length) / TABLE.width);
  const S = W / TABLE.width;
  const X = (x: number) => x * S;
  const Y = (y: number) => (TABLE.length - y) * S;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;

  // Base: outfield grass with mowing stripes.
  ctx.fillStyle = theme.grass[0];
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = i % 2 ? theme.grass[1] : theme.grass[0];
    ctx.beginPath();
    ctx.moveTo(X(11), Y(15));
    ctx.arc(X(11), Y(15), 32 * S, (Math.PI * (i + 24)) / 24 + Math.PI, (Math.PI * (i + 25)) / 24 + Math.PI);
    ctx.closePath();
    ctx.fill();
  }

  // Warning track and outfield wall shadow.
  ctx.save();
  ctx.beginPath();
  ctx.arc(X(TABLE.arcCenter.x), Y(TABLE.arcCenter.y), TABLE.arcRadius * S, Math.PI, 0);
  ctx.lineTo(X(22), Y(33));
  ctx.lineTo(X(0), Y(33));
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = theme.dirt;
  ctx.lineWidth = 1.6 * S;
  ctx.beginPath();
  ctx.arc(X(TABLE.arcCenter.x), Y(TABLE.arcCenter.y), (TABLE.arcRadius - 0.8) * S, Math.PI, 0);
  ctx.stroke();
  ctx.restore();

  // Lower apron: lacquered colour with a starburst, stars and pinstriped outlanes.
  const apronY = 13.0;
  const trim = theme.trim ?? '#d62828';
  const rnd = seeded(11);
  ctx.fillStyle = theme.apron;
  ctx.fillRect(0, Y(apronY), W, H - Y(apronY));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, Y(apronY), W, H - Y(apronY));
  ctx.clip();
  const shade = ctx.createLinearGradient(0, Y(apronY), 0, H);
  shade.addColorStop(0, 'rgba(255,255,255,0.10)');
  shade.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, Y(apronY), W, H - Y(apronY));
  for (let i = 0; i < 28; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.07)' : hexA(trim, 0.16);
    ctx.beginPath();
    ctx.moveTo(X(10.1), Y(8.3));
    ctx.arc(X(10.1), Y(8.3), 30 * S, (Math.PI * 2 * i) / 28, (Math.PI * 2 * (i + 1)) / 28);
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < 38; i++) star(ctx, X(rnd() * 20.2), Y(rnd() * apronY), (0.12 + rnd() * 0.16) * S, `rgba(255,255,255,${0.35 + rnd() * 0.5})`);
  // Pinstriped outlanes (a nod to the home uniform).
  for (const [x0, x1] of [[0, 1.8], [18.4, 20.2]]) {
    ctx.fillStyle = '#f4f0e4';
    ctx.fillRect(X(x0), Y(12.6), (x1 - x0) * S, Y(0) - Y(12.6));
    ctx.strokeStyle = 'rgba(16,36,96,0.55)';
    ctx.lineWidth = 0.05 * S;
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
  // Gold rule where the field meets the apron.
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, Y(apronY) - 0.07 * S, W, 0.14 * S);

  // Infield dirt: the classic diamond cut-out with grass inside.
  const d = def.diamond;
  ctx.fillStyle = theme.dirt;
  ctx.beginPath();
  ctx.arc(X(d.mound.x), Y(d.mound.y) + 0.3 * S, 7.2 * S, 0, Math.PI * 2);
  ctx.fill();
  // Inner grass.
  ctx.fillStyle = theme.grass[0];
  ctx.beginPath();
  ctx.moveTo(X(d.home.x), Y(d.home.y + 0.9));
  ctx.lineTo(X(d.first.x - 0.9), Y(d.first.y));
  ctx.lineTo(X(d.second.x), Y(d.second.y - 0.9));
  ctx.lineTo(X(d.third.x + 0.9), Y(d.third.y));
  ctx.closePath();
  ctx.fill();
  // Base paths.
  ctx.strokeStyle = theme.dirt;
  ctx.lineWidth = 1.1 * S;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(X(d.home.x), Y(d.home.y));
  ctx.lineTo(X(d.first.x), Y(d.first.y));
  ctx.lineTo(X(d.second.x), Y(d.second.y));
  ctx.lineTo(X(d.third.x), Y(d.third.y));
  ctx.closePath();
  ctx.stroke();
  // Mound and home plate circle.
  ctx.fillStyle = theme.dirt;
  ctx.beginPath();
  ctx.arc(X(d.mound.x), Y(d.mound.y), 1.1 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(X(d.home.x), Y(d.home.y), 1.6 * S, 0, Math.PI * 2);
  ctx.fill();
  // Cut the dirt circle where the apron begins (the apron is repainted over it below).

  // Chalk: foul lines, batter boxes, base markers.
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 0.13 * S;
  ctx.beginPath();
  ctx.moveTo(X(d.home.x), Y(d.home.y));
  ctx.lineTo(X(d.home.x - 10.2), Y(d.home.y + 10.2));
  ctx.moveTo(X(d.home.x), Y(d.home.y));
  ctx.lineTo(X(d.home.x + 10.2), Y(d.home.y + 10.2));
  ctx.stroke();
  ctx.strokeRect(X(d.home.x + 0.55), Y(d.home.y + 0.7), 0.6 * S, 1.4 * S);
  ctx.strokeRect(X(d.home.x - 1.15), Y(d.home.y + 0.7), 0.6 * S, 1.4 * S);

  // Lane art: arrows and labels for every shot.
  const label = (text: string, x: number, y: number, size = 0.55, color = '#ffffff', angle = 0, bold = true) => {
    ctx.save();
    ctx.translate(X(x), Y(y));
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.font = `${bold ? 'bold ' : ''}${size * S}px "Arial Black", Impact, "Helvetica Neue", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  const arrow = (x: number, y: number, len: number, color: string, angle = 0) => {
    ctx.save();
    ctx.translate(X(x), Y(y));
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < 3; i++) {
      const yy = -i * 0.55 * S;
      ctx.beginPath();
      ctx.moveTo(-0.45 * S, yy + 0.2 * S);
      ctx.lineTo(0, yy - 0.25 * S);
      ctx.lineTo(0.45 * S, yy + 0.2 * S);
      ctx.lineTo(0, yy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    void len;
  };
  arrow(4.5, 21.0, 2, theme.accent2);
  label('LEFT FIELD', 4.5, 19.9, 0.46, '#ffffff');
  arrow(15.7, 21.0, 2, '#ff8a3b');
  label('RIGHT FIELD', 15.7, 19.9, 0.46, '#ffffff');
  arrow(10.1, 22.2, 2, '#fff176');
  label('2B POWER', 10.1, 20.3, 0.42, '#fff176');
  label('HOME RUN', 1.3, 27.8, 0.42, '#ff6b6b', -Math.PI / 2);
  arrow(1.3, 24.9, 2, '#ff6b6b');
  label('DUGOUT', 18.7, 25.4, 0.4, '#d8b4ff');
  arrow(18.7, 23.3, 2, '#c77dff');
  label('BALL', 2.0, 40.4, 0.34, '#ffffff');
  label('STRIKE', 4.5, 40.4, 0.34, '#ffffff');
  label('OUT', 6.7, 40.4, 0.34, '#ffffff');
  label('KICKBACK', 0.9, 7.6, 0.3, '#9be7ff', -Math.PI / 2);
  label('LF', 3.4, 13.6, 0.4, theme.accent);
  label('RF', 16.8, 13.6, 0.4, theme.accent);
  label('3B', 7.45, 22.5, 0.5, '#ffffff');
  label('1B', 12.75, 22.5, 0.5, '#ffffff');
  label('LOCK', 18.7, 27.3, 0.36, '#d8b4ff');
  label('SANDLOT', 4.5, 21.75, 0.26, '#3bff9a');
  label('REACTOR', 10.1, 29.45, 0.3, '#4dfff3');

  // Apron centrepiece: a slugger on a giant baseball, with a ribbon banner.
  medallion(ctx, X(10.1), Y(8.3), S, theme, trim);

  // Launch lane: striped plunger lane with ON DECK circle.
  ctx.fillStyle = '#2a2f45';
  ctx.fillRect(X(20.2), Y(32), 1.8 * S, Y(0) - Y(32));
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  for (let y = 4; y < 32; y += 1.5) {
    ctx.beginPath();
    ctx.moveTo(X(20.2), Y(y));
    ctx.lineTo(X(22), Y(y + 0.6));
    ctx.stroke();
  }
  ctx.fillStyle = theme.dirt;
  ctx.beginPath();
  ctx.arc(X(21.1), Y(2.4), 0.8 * S, 0, Math.PI * 2);
  ctx.fill();

  // Chrome bezels around every lamp insert (game lamps and chasers).
  const bezel = (x: number, y: number, r: number) => {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.arc(X(x), Y(y), (r + 0.1) * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e9edf3';
    ctx.lineWidth = 0.07 * S;
    ctx.beginPath();
    ctx.arc(X(x), Y(y), (r + 0.05) * S, 0, Math.PI * 2);
    ctx.stroke();
  };
  for (const lamp of def.lamps) bezel(lamp.pos.x, lamp.pos.y, 0.36);
  for (const c of CHASER_LAMPS) bezel(c.x, c.y, 0.26);

  // Subtle vignette + grain.
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  noise(ctx, W, H, 0.035);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const hexA = (hex: string, a: number): string => {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
};

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/** The apron art: a pinstriped slugger in his stance over a stitched baseball, under a ribbon banner. */
function medallion(ctx: CanvasRenderingContext2D, cx: number, cy: number, S: number, theme: Theme, trim: string): void {
  const navy = '#10235e';
  const R = 2.85 * S;
  ctx.save();
  ctx.translate(cx, cy);
  // Glow + gold rim + the ball.
  const glow = ctx.createRadialGradient(0, 0, R * 0.8, 0, 0, R * 1.35);
  glow.addColorStop(0, 'rgba(255,230,140,0.55)');
  glow.addColorStop(1, 'rgba(255,230,140,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(0, 0, R + 0.22 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = trim;
  ctx.beginPath();
  ctx.arc(0, 0, R + 0.1 * S, 0, Math.PI * 2);
  ctx.fill();
  const ball = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R);
  ball.addColorStop(0, '#ffffff');
  ball.addColorStop(1, '#e4ddca');
  ctx.fillStyle = ball;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  // Seams with stitches: two arcs whose centres sit outside the ball.
  ctx.strokeStyle = '#d0232a';
  for (const side of [-1, 1]) {
    const ox = side * R * 1.45;
    const mid = side > 0 ? Math.PI : 0;
    ctx.lineWidth = 0.09 * S;
    ctx.beginPath();
    ctx.arc(ox, 0, R * 0.95, mid - 0.95, mid + 0.95);
    ctx.stroke();
    ctx.lineWidth = 0.05 * S;
    for (let i = -6; i <= 6; i++) {
      const a = mid + (i / 6) * 0.9;
      const px = ox + Math.cos(a) * R * 0.95;
      const py = Math.sin(a) * R * 0.95;
      ctx.beginPath();
      ctx.moveTo(px - 0.13 * S, py - 0.08 * S);
      ctx.lineTo(px + 0.13 * S, py + 0.08 * S);
      ctx.stroke();
    }
  }

  // The slugger (units of u, y up).
  const u = S * 0.92;
  const P = (x: number, y: number): [number, number] => [x * u, -y * u + 0.35 * S];
  const limb = (pts: Array<[number, number]>, w: number, color: string) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [col, ww] of [[navy, w + 0.16], [color, w]] as Array<[string, number]>) {
      ctx.strokeStyle = col;
      ctx.lineWidth = ww * u;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(...P(x, y)) : ctx.moveTo(...P(x, y))));
      ctx.stroke();
    }
  };
  const uniform = '#f7f5ee';
  // Bat (behind the head), legs, torso, arms, head.
  limb([[-0.35, 1.45], [-1.55, 2.95]], 0.22, '#d9a25a');
  limb([[-0.25, 0.1], [-0.75, -0.75], [-1.05, -1.75]], 0.42, uniform);
  limb([[0.25, 0.1], [0.85, -0.7], [0.75, -1.75]], 0.42, uniform);
  limb([[-1.05, -1.8], [-1.45, -1.85]], 0.26, navy);
  limb([[0.75, -1.8], [1.15, -1.85]], 0.26, navy);
  limb([[0, 0.15], [0.05, 1.25]], 0.95, uniform);
  // Pinstripes on the jersey.
  ctx.save();
  ctx.beginPath();
  ctx.rect(...P(-0.42, 1.7), 0.84 * u, 1.6 * u);
  ctx.clip();
  ctx.strokeStyle = 'rgba(16,35,94,0.55)';
  ctx.lineWidth = 0.05 * u;
  for (let x = -0.4; x <= 0.45; x += 0.18) {
    ctx.beginPath();
    ctx.moveTo(...P(x, 1.7));
    ctx.lineTo(...P(x, 0));
    ctx.stroke();
  }
  ctx.restore();
  limb([[-0.05, 0.12], [0.12, 0.12]], 0.2, trim); // belt
  limb([[0.4, 1.15], [0.35, 0.8], [-0.3, 1.4]], 0.3, uniform);
  limb([[-0.35, 1.1], [-0.55, 1.15], [-0.35, 1.45]], 0.3, uniform);
  ctx.fillStyle = '#f0c7a0';
  ctx.strokeStyle = navy;
  ctx.lineWidth = 0.08 * u;
  ctx.beginPath();
  ctx.arc(...P(0.1, 1.85), 0.36 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Batting helmet.
  ctx.fillStyle = trim;
  ctx.beginPath();
  ctx.arc(...P(0.08, 1.92), 0.39 * u, Math.PI * 1.02, Math.PI * 2.05);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  limb([[0.3, 1.88], [0.62, 1.84]], 0.1, trim);

  // Ribbon banner across the bottom of the ball.
  const bw = 4.3 * S;
  const bh = 0.62 * S;
  const by = R * 0.62;
  ctx.fillStyle = '#9c1219';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * bw * 0.86, by - bh * 0.2);
    ctx.lineTo(side * bw * 1.12, by - bh * 0.2);
    ctx.lineTo(side * bw * 1.02, by + bh * 0.5);
    ctx.lineTo(side * bw * 1.12, by + bh * 1.2);
    ctx.lineTo(side * bw * 0.86, by + bh * 1.2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = trim;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 0.07 * S;
  ctx.beginPath();
  ctx.rect(-bw * 0.92, by - bh * 0.5, bw * 1.84, bh * 1.35);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `${0.62 * S}px "Arial Black", Impact, "Helvetica Neue", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 4;
  ctx.fillText('DIAMOND PINBALL', 0, by + bh * 0.2, bw * 1.76);
  ctx.restore();
}

/** Classic neon arcade carpet for the floor around the machine. */
export function createArcadeCarpet(): THREE.CanvasTexture {
  const w = 256;
  const c = makeCanvas(w, w);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0d0f2a';
  ctx.fillRect(0, 0, w, w);
  const rnd = seeded(5);
  const palette = ['#ff3b9a', '#3fd0ff', '#ffd23f', '#7cff5a', '#c77dff'];
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w;
    const y = rnd() * w;
    const col = palette[i % palette.length];
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.4;
    const kind = i % 3;
    if (kind === 0) {
      ctx.beginPath();
      ctx.arc(x, y, 6 + rnd() * 8, 0, Math.PI * 2);
      ctx.stroke();
    } else if (kind === 1) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 1; k <= 4; k++) ctx.lineTo(x + k * 9, y + (k % 2 ? -8 : 8));
      ctx.stroke();
    } else star(ctx, x, y, 7 + rnd() * 5, col);
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(20, 20);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Blurred arcade lights for the room behind the machine. */
export function createArcadeBackdrop(): THREE.CanvasTexture {
  const w = 2048;
  const h = 512;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#05061a');
  g.addColorStop(0.55, '#141a4a');
  g.addColorStop(1, '#0a0c24');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rnd = seeded(3);
  const palette = ['#ff3b6b', '#3f8cff', '#ffd23f', '#3bff9a', '#c77dff', '#ff8a3b', '#4fe3ff'];
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 140; i++) {
    const x = rnd() * w;
    const y = h * (0.3 + rnd() * 0.5);
    const r = 6 + rnd() * 34;
    const col = new THREE.Color(palette[Math.floor(rnd() * palette.length)]);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
    rg.addColorStop(0, `rgba(${rgb},${0.25 + rnd() * 0.4})`);
    rg.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ----------------------------------------------------------------------------
// Backglass scoreboard

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

export function createScoreboard(theme: Theme): Scoreboard {
  const W = 1024;
  const H = 512;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;

  const update = (data: ScoreboardData) => {
    const s = data.baseball;
    ctx.fillStyle = '#070b1a';
    ctx.fillRect(0, 0, W, H);
    // Frame glow.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, W - 20, H - 20);

    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.accent;
    ctx.font = 'bold 54px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('DIAMOND PINBALL', 40, 60);
    ctx.textAlign = 'right';
    ctx.font = 'bold 40px "Courier New", monospace';
    ctx.fillStyle = '#ffd36a';
    ctx.fillText(data.pinballScore.toLocaleString('en-US'), W - 40, 60);

    // Line score.
    const innings = Math.max(s.totalInnings, s.inning);
    const cols = Math.min(innings, 9) + 3;
    const x0 = 40;
    const colW = (W - 80 - 200) / cols;
    const rowH = 56;
    const y0 = 120;
    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.textAlign = 'center';
    const headers: string[] = [];
    for (let i = 1; i <= Math.min(innings, 9); i++) headers.push(String(i));
    headers.push('R', 'H', 'E');
    ctx.fillStyle = '#9fb3d9';
    headers.forEach((hText, i) => ctx.fillText(hText, x0 + 200 + colW * i + colW / 2, y0));
    const drawRow = (side: 'away' | 'home', y: number) => {
      const line = s[side];
      const batting = (s.half === 'top') === (side === 'away') && !s.gameOver;
      ctx.textAlign = 'left';
      ctx.fillStyle = batting ? theme.accent : '#e8ecf5';
      ctx.font = 'bold 30px "Arial Black", Impact, sans-serif';
      ctx.fillText((batting ? '▶ ' : '  ') + TEAM_NAMES[side] + (side === PLAYER_SIDE ? ' (YOU)' : ''), x0, y);
      ctx.textAlign = 'center';
      ctx.font = 'bold 30px "Courier New", monospace';
      for (let i = 0; i < Math.min(innings, 9); i++) {
        const v = line.innings[i];
        ctx.fillStyle = v === undefined ? '#3b4766' : '#ffffff';
        ctx.fillText(v === undefined ? '-' : String(v), x0 + 200 + colW * i + colW / 2, y);
      }
      const base = Math.min(innings, 9);
      ctx.fillStyle = '#ffd36a';
      ctx.fillText(String(line.runs), x0 + 200 + colW * base + colW / 2, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(line.hits), x0 + 200 + colW * (base + 1) + colW / 2, y);
      ctx.fillText(String(line.errors), x0 + 200 + colW * (base + 2) + colW / 2, y);
    };
    drawRow('away', y0 + rowH);
    drawRow('home', y0 + rowH * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + rowH * 0.5);
    ctx.lineTo(W - 40, y0 + rowH * 0.5);
    ctx.stroke();

    // Situation row: inning, outs, count, bases.
    const sy = 330;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px "Arial Black", Impact, sans-serif';
    ctx.fillText(s.gameOver ? 'FINAL' : `${s.half === 'top' ? 'TOP' : 'BOT'} ${s.inning}`, x0, sy);
    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.fillStyle = '#9fb3d9';
    ctx.fillText('OUTS', x0 + 200, sy);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(x0 + 290 + i * 34, sy, 11, 0, Math.PI * 2);
      ctx.fillStyle = i < s.outs ? '#ff4d4d' : '#2b3550';
      ctx.fill();
    }
    ctx.fillStyle = '#9fb3d9';
    ctx.fillText(`COUNT ${s.balls}-${s.strikes}`, x0 + 420, sy);
    // Bases diamond.
    const bx = W - 130;
    const by = sy;
    const drawBase = (dx: number, dy: number, on: boolean) => {
      ctx.save();
      ctx.translate(bx + dx, by + dy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = on ? '#ffd36a' : '#2b3550';
      ctx.fillRect(-11, -11, 22, 22);
      ctx.restore();
    };
    drawBase(26, 0, !!s.bases[0]);
    drawBase(0, -26, !!s.bases[1]);
    drawBase(-26, 0, !!s.bases[2]);
    ctx.fillStyle = '#9fb3d9';
    ctx.textAlign = 'right';
    ctx.fillText(`BALL ${Math.max(1, 4 - data.ballsLeft)}  x${data.multiplier}`, bx - 60, sy);

    // Message ticker.
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(40, 400, W - 80, 80);
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.accent;
    ctx.font = 'bold 42px "Arial Black", Impact, sans-serif';
    ctx.fillText(data.message, W / 2, 440);
    texture.needsUpdate = true;
  };

  return { texture, update };
}
