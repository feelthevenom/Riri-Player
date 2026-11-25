import { DarkModePreference, ThemeSurfaceStyle } from '../types/music';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.slice(0, 6);
  const num = parseInt(full || 'ED5564', 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function mixHex(hexA: string, hexB: string, weightB: number): string {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const wA = 1 - weightB;
  return rgbToHex(r1 * wA + r2 * weightB, g1 * wA + g2 * weightB, b1 * wA + b2 * weightB);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function applyMaterialTheme(
  seedHex: string,
  darkMode: DarkModePreference,
  pureBlack: boolean,
  surfaceStyle: ThemeSurfaceStyle = 'GLASS',
) {
  const prefersDark =
    darkMode === 'DARK' ||
    (darkMode === 'SYSTEM' &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  const root = document.documentElement;
  const effectiveBlack = pureBlack || surfaceStyle === 'PURE_BLACK';
  const primary = seedHex || '#ED5564';

  root.classList.toggle('dark', prefersDark);
  root.setAttribute('data-surface-style', surfaceStyle);

  if (prefersDark) {
    const bgBase = effectiveBlack ? '#000000' : mixHex('#0E0C0D', primary, 0.04);
    const surfLow = effectiveBlack ? '#070607' : mixHex('#161214', primary, 0.05);
    const surf = effectiveBlack ? '#100E0F' : mixHex('#1E191B', primary, 0.06);
    const surfHigh = effectiveBlack ? '#191617' : mixHex('#282224', primary, 0.07);
    const surfHighest = effectiveBlack ? '#242022' : mixHex('#342C2F', primary, 0.08);

    const lightPrimary = mixHex(primary, '#FFFFFF', 0.22);
    const onPrimary = luminance(lightPrimary) > 0.45 ? '#1A0B0E' : '#FFFFFF';
    const primaryContainer = mixHex('#1B1215', primary, 0.34);
    const onPrimaryContainer = mixHex(primary, '#FFFFFF', 0.8);
    const secondary = mixHex(primary, '#E8DCE0', 0.72);
    const secondaryContainer = mixHex('#1D1719', primary, 0.22);
    const tertiary = mixHex(primary, '#F4C790', 0.55);

    const vars: Record<string, string> = {
      '--md-primary': lightPrimary,
      '--md-on-primary': onPrimary,
      '--md-primary-container': primaryContainer,
      '--md-on-primary-container': onPrimaryContainer,
      '--md-secondary': secondary,
      '--md-secondary-container': secondaryContainer,
      '--md-on-secondary-container': mixHex(secondary, '#FFFFFF', 0.65),
      '--md-tertiary': tertiary,
      '--md-tertiary-container': mixHex('#241B12', tertiary, 0.28),
      '--md-background': bgBase,
      '--md-surface': bgBase,
      '--md-surface-container-low': surfLow,
      '--md-surface-container': surf,
      '--md-surface-container-high': surfHigh,
      '--md-surface-container-highest': surfHighest,
      '--md-on-surface': '#F5EFF1',
      '--md-on-surface-variant': '#C7BAC0',
      '--md-outline': '#5C4F54',
      '--md-outline-variant': '#352C30',
      '--at-glass-bg': rgba(surfLow, 0.68),
      '--at-glass-card': rgba(surfHigh, 0.48),
      '--at-glass-border': 'rgba(255, 255, 255, 0.12)',
      '--at-shell-blur': surfaceStyle === 'GLASS' ? 'blur(24px) saturate(160%)' : 'none',
      '--at-ambient-bg':
        surfaceStyle === 'GLASS'
          ? `radial-gradient(circle at 18% 12%, ${rgba(primary, 0.24)}, transparent 44%), radial-gradient(circle at 82% 85%, ${rgba(tertiary, 0.14)}, transparent 48%), linear-gradient(160deg, ${bgBase}, #0A0809)`
          : 'none',
    };
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  } else {
    const bgBase = mixHex('#FAF7F8', primary, 0.03);
    const surfLow = mixHex('#F4EFF1', primary, 0.04);
    const surf = mixHex('#ECE5E8', primary, 0.05);
    const surfHigh = mixHex('#E4DBE0', primary, 0.06);
    const surfHighest = mixHex('#DBD0D6', primary, 0.07);

    const darkPrimary = mixHex(primary, '#000000', 0.12);
    const onPrimary = luminance(darkPrimary) > 0.48 ? '#1A0B0E' : '#FFFFFF';
    const primaryContainer = mixHex('#FFFFFF', primary, 0.2);
    const onPrimaryContainer = mixHex(primary, '#1C090C', 0.68);

    const vars: Record<string, string> = {
      '--md-primary': darkPrimary,
      '--md-on-primary': onPrimary,
      '--md-primary-container': primaryContainer,
      '--md-on-primary-container': onPrimaryContainer,
      '--md-secondary': mixHex(primary, '#5E4B50', 0.7),
      '--md-secondary-container': mixHex('#FFFFFF', primary, 0.15),
      '--md-on-secondary-container': '#2A1D21',
      '--md-tertiary': mixHex(primary, '#8D5B2C', 0.6),
      '--md-tertiary-container': '#FFE5C8',
      '--md-background': bgBase,
      '--md-surface': bgBase,
      '--md-surface-container-low': surfLow,
      '--md-surface-container': surf,
      '--md-surface-container-high': surfHigh,
      '--md-surface-container-highest': surfHighest,
      '--md-on-surface': '#1C1618',
      '--md-on-surface-variant': '#57484D',
      '--md-outline': '#857378',
      '--md-outline-variant': '#D1C1C6',
      '--at-glass-bg': 'rgba(255, 255, 255, 0.72)',
      '--at-glass-card': 'rgba(255, 255, 255, 0.56)',
      '--at-glass-border': 'rgba(24, 18, 20, 0.10)',
      '--at-shell-blur': surfaceStyle === 'GLASS' ? 'blur(24px) saturate(165%)' : 'none',
      '--at-ambient-bg':
        surfaceStyle === 'GLASS'
          ? `radial-gradient(circle at 16% 12%, ${rgba(primary, 0.18)}, transparent 45%), radial-gradient(circle at 86% 80%, ${rgba(primary, 0.12)}, transparent 50%), linear-gradient(160deg, #FFFFFF, ${surfLow})`
          : 'none',
    };
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  }
}

export interface DynamicOverlayGradientTheme {
  background: string;
  borderColor: string;
  boxShadow: string;
  primary: string;
  onPrimary: string;
  primaryRgba: string;
  accentText: string;
}

export function buildAlbumGradientTheme(
  primaryHex: string,
  secondaryHex: string,
): DynamicOverlayGradientTheme {
  const primary = primaryHex || '#ED5564';
  const secondary = secondaryHex || mixHex(primary, '#120D10', 0.65);

  // Calibrate gradient stops so bright album covers still keep crisp white text contrast
  const primaryLum = luminance(primary);
  const topLeftStop =
    primaryLum > 0.45 ? mixHex(primary, '#0B0A0E', 0.42) : mixHex(primary, '#0B0A0E', 0.22);
  const midStop = mixHex(secondary, '#0B0A0E', 0.46);
  const bottomRightStop = mixHex(primary, '#070609', 0.74);

  const vibrantPrimary =
    primaryLum < 0.16 ? mixHex(primary, '#FFFFFF', 0.28) : primary;
  const onPrimary = luminance(vibrantPrimary) > 0.48 ? '#110B0D' : '#FFFFFF';

  return {
    background: `radial-gradient(circle at 12% 10%, ${rgba(vibrantPrimary, 0.48)} 0%, transparent 58%), linear-gradient(135deg, ${topLeftStop} 0%, ${midStop} 52%, ${bottomRightStop} 100%)`,
    borderColor: rgba(vibrantPrimary, 0.48),
    boxShadow: `0 18px 40px rgba(0, 0, 0, 0.55), inset 0 1px 0 ${rgba('#FFFFFF', 0.16)}`,
    primary: vibrantPrimary,
    onPrimary,
    primaryRgba: rgba(vibrantPrimary, 0.32),
    accentText: mixHex(vibrantPrimary, '#FFFFFF', 0.55),
  };
}

function sampleImagePalette(
  img: HTMLImageElement,
  fallbackHex: string,
): { primary: string; secondary: string } {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { primary: fallbackHex, secondary: mixHex(fallbackHex, '#120D10', 0.65) };
  }

  ctx.drawImage(img, 0, 0, 32, 32);
  const { data } = ctx.getImageData(0, 0, 32, 32);

  let bestScore = -1;
  let bestRgb: [number, number, number] = hexToRgb(fallbackHex);
  let secondScore = -1;
  let secondRgb: [number, number, number] | null = null;

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 128) continue;

    rSum += r;
    gSum += g;
    bSum += b;
    count++;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

    if (lum > 0.12 && lum < 0.88) {
      const score = sat * 2.4 + (1 - Math.abs(lum - 0.5)) * 0.6;
      if (score > bestScore) {
        if (bestScore > 0) {
          const dist =
            Math.abs(r - bestRgb[0]) + Math.abs(g - bestRgb[1]) + Math.abs(b - bestRgb[2]);
          if (dist > 75 && bestScore > secondScore) {
            secondScore = bestScore;
            secondRgb = bestRgb;
          }
        }
        bestScore = score;
        bestRgb = [r, g, b];
      } else if (score > secondScore) {
        const dist =
          Math.abs(r - bestRgb[0]) + Math.abs(g - bestRgb[1]) + Math.abs(b - bestRgb[2]);
        if (dist > 75) {
          secondScore = score;
          secondRgb = [r, g, b];
        }
      }
    }
  }

  const primary = rgbToHex(bestRgb[0], bestRgb[1], bestRgb[2]);
  const avg =
    count > 0
      ? rgbToHex(rSum / count, gSum / count, bSum / count)
      : mixHex(primary, '#0E0B0C', 0.65);

  const secondaryRaw = secondRgb
    ? rgbToHex(secondRgb[0], secondRgb[1], secondRgb[2])
    : avg;

  return {
    primary,
    secondary: mixHex(secondaryRaw, '#0C090A', 0.45),
  };
}

export async function extractPaletteFromArtwork(
  imageUrl: string,
  fallbackHex = '#ED5564',
): Promise<{ primary: string; secondary: string }> {
  const defaultPalette = {
    primary: fallbackHex,
    secondary: mixHex(fallbackHex, '#0D0D0D', 0.72),
  };

  if (!imageUrl) return defaultPalette;

  const isRemote = imageUrl.startsWith('http://') || imageUrl.startsWith('https://');
  const isHttpOrigin =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:');

  const candidates: string[] = [];
  if (isRemote) {
    if (isHttpOrigin) {
      candidates.push(`/api/proxy-image?url=${encodeURIComponent(imageUrl)}`);
    }
    candidates.push(imageUrl);
  } else {
    candidates.push(imageUrl);
  }

  const tryLoad = (src: string): Promise<{ primary: string; secondary: string } | null> =>
    new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          resolve(sampleImagePalette(img, fallbackHex));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });

  for (const src of candidates) {
    const result = await tryLoad(src);
    if (result) return result;
  }

  return defaultPalette;
}