// Client-side CAD image difference detection.

export interface DiffRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  position: string; // e.g. "top-left"
}

export interface DiffStats {
  width: number;
  height: number;
  changedPixels: number;
  totalPixels: number;
  percentChanged: number;
  regionCount: number;
  regions: DiffRegion[];
}

export interface DiffResult {
  imageAUrl: string; // normalized image A (dataURL)
  imageBUrl: string; // normalized image B (dataURL)
  diffMaskUrl: string; // red mask on transparent bg
  overlayUrl: string; // image A with mask + boxes overlayed
  sideBySideUrl: string; // A|B|diff triptych
  stats: DiffStats;
}

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function toCanvas(img: HTMLImageElement, w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  // For CAD images, preserve sharp lines with white fill background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas: c, ctx };
}

function positionLabel(cx: number, cy: number, W: number, H: number) {
  const vert = cy < H / 3 ? "top" : cy > (2 * H) / 3 ? "bottom" : "middle";
  const horiz = cx < W / 3 ? "left" : cx > (2 * W) / 3 ? "right" : "center";
  if (vert === "middle" && horiz === "center") return "center";
  if (vert === "middle") return horiz;
  if (horiz === "center") return vert;
  return `${vert}-${horiz}`;
}

/**
 * Compute grayscale-difference mask + connected component regions.
 * threshold: 0-255 intensity delta considered changed.
 * minArea: ignore regions smaller than this many pixels (noise).
 */
export async function computeDiff(
  fileA: File,
  fileB: File,
  opts: { threshold?: number; minArea?: number; maxDim?: number } = {},
): Promise<DiffResult> {
  const threshold = opts.threshold ?? 35;
  const maxDim = opts.maxDim ?? 1024;

  const [imgA, imgB] = await Promise.all([loadImage(fileA), loadImage(fileB)]);

  // Common size: fit image A into maxDim box, use same for B.
  const scale = Math.min(1, maxDim / Math.max(imgA.width, imgA.height));
  const W = Math.max(1, Math.round(imgA.width * scale));
  const H = Math.max(1, Math.round(imgA.height * scale));
  const minArea = opts.minArea ?? Math.max(25, Math.round((W * H) / 8000));

  const A = toCanvas(imgA, W, H);
  const B = toCanvas(imgB, W, H);
  const aData = A.ctx.getImageData(0, 0, W, H);
  const bData = B.ctx.getImageData(0, 0, W, H);

  // Binary mask: 1 where changed.
  const mask = new Uint8Array(W * H);
  let changedPixels = 0;
  for (let i = 0, p = 0; i < aData.data.length; i += 4, p++) {
    const ga = 0.299 * aData.data[i] + 0.587 * aData.data[i + 1] + 0.114 * aData.data[i + 2];
    const gb = 0.299 * bData.data[i] + 0.587 * bData.data[i + 1] + 0.114 * bData.data[i + 2];
    if (Math.abs(ga - gb) > threshold) {
      mask[p] = 1;
      changedPixels++;
    }
  }

  // Simple dilation (3x3) to close small gaps.
  const dilated = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (mask[idx]) {
        dilated[idx] = 1;
        continue;
      }
      let hit = 0;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && mask[ny * W + nx]) hit = 1;
        }
      }
      dilated[idx] = hit;
    }
  }

  // Connected components (4-neighbour BFS) → bounding boxes.
  const visited = new Uint8Array(W * H);
  const regions: DiffRegion[] = [];
  const stack = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = y * W + x;
      if (!dilated[s] || visited[s]) continue;
      let top = 0;
      stack[top++] = s;
      visited[s] = 1;
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y,
        area = 0;
      while (top > 0) {
        const p = stack[--top];
        const px = p % W;
        const py = (p - px) / W;
        area++;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        const neighbours = [p - 1, p + 1, p - W, p + W];
        const okX = [px > 0, px < W - 1, true, true];
        for (let n = 0; n < 4; n++) {
          const q = neighbours[n];
          if (!okX[n] || q < 0 || q >= W * H) continue;
          if (dilated[q] && !visited[q]) {
            visited[q] = 1;
            stack[top++] = q;
          }
        }
      }
      if (area >= minArea) {
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        regions.push({
          x: minX,
          y: minY,
          w: maxX - minX + 1,
          h: maxY - minY + 1,
          area,
          position: positionLabel(cx, cy, W, H),
        });
      }
    }
  }

  regions.sort((a, b) => b.area - a.area);

  // Diff mask canvas (red on transparent).
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = W;
  maskCanvas.height = H;
  const mctx = maskCanvas.getContext("2d")!;
  const maskImg = mctx.createImageData(W, H);
  for (let p = 0; p < dilated.length; p++) {
    if (dilated[p]) {
      const i = p * 4;
      maskImg.data[i] = 239;
      maskImg.data[i + 1] = 68;
      maskImg.data[i + 2] = 68;
      maskImg.data[i + 3] = 220;
    }
  }
  mctx.putImageData(maskImg, 0, 0);

  // Overlay canvas: image A + mask + bounding boxes.
  const overlay = document.createElement("canvas");
  overlay.width = W;
  overlay.height = H;
  const octx = overlay.getContext("2d")!;
  octx.drawImage(A.canvas, 0, 0);
  octx.globalAlpha = 0.55;
  octx.drawImage(maskCanvas, 0, 0);
  octx.globalAlpha = 1;
  octx.strokeStyle = "#22d3ee";
  octx.lineWidth = Math.max(2, Math.round(W / 500));
  octx.font = `${Math.max(12, Math.round(W / 80))}px ui-monospace, monospace`;
  octx.fillStyle = "#22d3ee";
  regions.forEach((r, i) => {
    octx.strokeRect(r.x, r.y, r.w, r.h);
    const label = `#${i + 1}`;
    const th = Math.max(12, Math.round(W / 80));
    octx.fillRect(r.x, Math.max(0, r.y - th - 4), th * 2.5, th + 4);
    octx.fillStyle = "#0b1220";
    octx.fillText(label, r.x + 4, Math.max(th, r.y - 6));
    octx.fillStyle = "#22d3ee";
  });

  // Side-by-side triptych.
  const gap = 8;
  const sbs = document.createElement("canvas");
  sbs.width = W * 3 + gap * 2;
  sbs.height = H;
  const sctx = sbs.getContext("2d")!;
  sctx.fillStyle = "#0b1220";
  sctx.fillRect(0, 0, sbs.width, sbs.height);
  sctx.drawImage(A.canvas, 0, 0);
  sctx.drawImage(B.canvas, W + gap, 0);
  sctx.drawImage(overlay, (W + gap) * 2, 0);

  const totalPixels = W * H;
  return {
    imageAUrl: A.canvas.toDataURL("image/png"),
    imageBUrl: B.canvas.toDataURL("image/png"),
    diffMaskUrl: maskCanvas.toDataURL("image/png"),
    overlayUrl: overlay.toDataURL("image/png"),
    sideBySideUrl: sbs.toDataURL("image/png"),
    stats: {
      width: W,
      height: H,
      changedPixels,
      totalPixels,
      percentChanged: (changedPixels / totalPixels) * 100,
      regionCount: regions.length,
      regions,
    },
  };
}