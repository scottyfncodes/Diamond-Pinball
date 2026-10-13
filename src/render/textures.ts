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
}

export const THEMES: Record<string, Theme> = {
  classic: { id: 'classic', name: 'Classic Oak', cabinet: '#7a4a24', cabinetDark: '#4a2a12', rail: 0xc9ccd1, railMetalness: 0.9, accent: '#f5c542', accent2: '#2c7be5', grass: ['#2f8a3c', '#2a7d36'], dirt: '#b7733b', apron: '#13213f', glow: 0xffc24d },
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

  // Lower apron: deep navy with art-deco rays.
  const apronY = 13.0;
  ctx.fillStyle = theme.apron;
  ctx.fillRect(0, Y(apronY), W, H - Y(apronY));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, Y(apronY), W, H - Y(apronY));
  ctx.clip();
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.0)';
    ctx.beginPath();
    ctx.moveTo(X(11), Y(0) + 40);
    ctx.arc(X(11), Y(0) + 40, 40 * S, Math.PI + (Math.PI * i) / 14, Math.PI + (Math.PI * (i + 1)) / 14);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Soft transition between apron and grass.
  const grad = ctx.createLinearGradient(0, Y(apronY + 1.2), 0, Y(apronY));
  grad.addColorStop(0, 'rgba(19,33,63,0)');
  grad.addColorStop(1, theme.apron);
  ctx.fillStyle = grad;
  ctx.fillRect(0, Y(apronY + 1.2), W, Y(apronY) - Y(apronY + 1.2));

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
  // Cut the dirt circle where the apron begins.
  ctx.fillStyle = theme.apron;
  ctx.fillRect(0, Y(apronY), W, 2);

  // Chalk: foul lines, batter boxes, base markers.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 0.09 * S;
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

  // Apron graphics: logo, ball-count card, instructions.
  label('DIAMOND', 10.1, 8.9, 1.5, theme.accent);
  label('PINBALL', 10.1, 7.1, 1.5, '#ffffff');
  label('SHOOT RAMPS TO BAT  •  HIT BASES TO STEAL  •  LOCK BALLS FOR MULTIBALL', 10.1, 5.4, 0.36, 'rgba(255,255,255,0.7)');
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 4;
  ctx.strokeRect(X(6.4), Y(10.2), 7.4 * S, 5.8 * S);

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

  // Insert outlines around every lamp.
  for (const lamp of def.lamps) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(X(lamp.pos.x), Y(lamp.pos.y), 0.42 * S, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Subtle vignette + grain.
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  noise(ctx, W, H, 0.035);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
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
