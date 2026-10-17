/**
 * Downscales an image file to a square-ish JPEG data URL (longest side `max` px)
 * before it is saved to `photoUrl`, so the demo store stays small.
 */
export async function downscalePhoto(file: File, max = 256, quality = 0.85): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('notImage');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('notImage'));
      el.src = url;
    });
    // Centre-crop to a square, then scale down: portraits are shown in circles.
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const out = Math.min(max, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('notImage');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
