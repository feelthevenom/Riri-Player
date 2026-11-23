import { Track } from '../types/music';

/**
 * Generates a 2x2 grid collage from the top 4 track thumbnails of a playlist.
 * Returns a data URL for the generated collage image.
 */
export async function generatePlaylistCoverCollage(
  tracks: Track[],
  size = 256
): Promise<string | null> {
  if (tracks.length === 0) return null;

  // Get up to 4 tracks with valid thumbnails
  const validTracks = tracks.filter((t) => t.thumbnailUrl && !t.thumbnailUrl.includes('data:'));
  if (validTracks.length === 0) return null;

  const topTracks = validTracks.slice(0, 4);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (!ctx) return null;

  const cellSize = size / 2;

  // Draw background
  ctx.fillStyle = '#1a1317';
  ctx.fillRect(0, 0, size, size);

  // Load images and draw them
  const imagePromises = topTracks.map((track) => {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load ${track.thumbnailUrl}`));
      img.src = track.thumbnailUrl;
    });
  });

  try {
    const images = await Promise.allSettled(imagePromises);
    
    images.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const img = result.value;
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = col * cellSize;
        const y = row * cellSize;

        // Calculate scaling to fill the cell while maintaining aspect ratio
        const scale = Math.max(cellSize / img.width, cellSize / img.height);
        const drawWidth = img.width * scale;
        const drawHeight = img.height * scale;
        const drawX = x + (cellSize - drawWidth) / 2;
        const drawY = y + (cellSize - drawHeight) / 2;

        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      }
    });

    // If we have fewer than 4 images, fill remaining cells with a subtle pattern
    const filledCount = images.filter((r) => r.status === 'fulfilled').length;
    if (filledCount < 4) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
      for (let i = filledCount; i < 4; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        ctx.fillRect(col * cellSize + 4, row * cellSize + 4, cellSize - 8, cellSize - 8);
      }
    }

    return canvas.toDataURL('image/png', 0.9);
  } catch {
    return null;
  }
}

/**
 * Hook to generate and cache playlist cover collages
 */
import { useMemo, useState, useEffect, useCallback } from 'react';

interface UsePlaylistCoverOptions {
  tracks: Track[];
  existingCoverUrl?: string;
  size?: number;
}

export function usePlaylistCover({ tracks, existingCoverUrl, size = 256 }: UsePlaylistCoverOptions) {
  const [coverUrl, setCoverUrl] = useState<string | null>(existingCoverUrl || null);
  const [loading, setLoading] = useState(false);

  const generateCover = useCallback(async () => {
    if (tracks.length === 0) return;
    setLoading(true);
    const collage = await generatePlaylistCoverCollage(tracks, size);
    setCoverUrl(collage);
    setLoading(false);
  }, [tracks, size]);

  useEffect(() => {
    if (!existingCoverUrl && tracks.length > 0) {
      generateCover();
    }
  }, [existingCoverUrl, tracks.length, generateCover]);

  return { coverUrl, loading, regenerate: generateCover };
}