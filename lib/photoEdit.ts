import { MAX_IMAGE_BYTES } from "@/lib/images";

export const JPEG_QUALITY = 0.92;
export const LISTING_LONG_SIDE = 1600;

export type PixelRect = { x: number; y: number; w: number; h: number };

function clampByte(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

function clampGain(value: number): number {
  if (value < 0.8) return 0.8;
  if (value > 1.25) return 1.25;
  return value;
}

export function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  const context = copy.getContext("2d");
  if (!context) throw new Error("Could not copy the photo.");
  context.drawImage(source, 0, 0);
  return copy;
}

export function canvasFromBlob(blob: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  return new Promise((resolve, reject) => {
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read that photo."));
        return;
      }
      context.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that photo."));
    };
    image.src = url;
  });
}

export function autoImproveCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not adjust the photo.");
  const image = context.getImageData(0, 0, source.width, source.height);
  const data = image.data;
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 16) continue;
    red += data[index];
    green += data[index + 1];
    blue += data[index + 2];
    count += 1;
  }
  if (count === 0) return cloneCanvas(source);

  const averageRed = red / count;
  const averageGreen = green / count;
  const averageBlue = blue / count;
  const gray = (averageRed + averageGreen + averageBlue) / 3;
  const redGain = clampGain(gray / (averageRed || 1));
  const greenGain = clampGain(gray / (averageGreen || 1));
  const blueGain = clampGain(gray / (averageBlue || 1));

  const balanced = new Uint8ClampedArray(data.length);
  let luminance = 0;
  let opaque = 0;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    balanced[index + 3] = alpha;
    if (alpha < 16) continue;
    const nextRed = clampByte(data[index] * redGain);
    const nextGreen = clampByte(data[index + 1] * greenGain);
    const nextBlue = clampByte(data[index + 2] * blueGain);
    balanced[index] = nextRed;
    balanced[index + 1] = nextGreen;
    balanced[index + 2] = nextBlue;
    luminance += 0.2126 * nextRed + 0.7152 * nextGreen + 0.0722 * nextBlue;
    opaque += 1;
  }

  const mean = opaque ? luminance / opaque : 128;
  const lift = Math.max(-24, Math.min(36, (142 - mean) * 0.65));
  const contrast = 1.16;
  const contrastShift = 128 * (1 - contrast);
  const toned = new Uint8ClampedArray(balanced);
  for (let index = 0; index < toned.length; index += 4) {
    if (toned[index + 3] < 16) continue;
    toned[index] = clampByte(toned[index] * contrast + contrastShift + lift);
    toned[index + 1] = clampByte(toned[index + 1] * contrast + contrastShift + lift);
    toned[index + 2] = clampByte(toned[index + 2] * contrast + contrastShift + lift);
  }

  const sharpened = new Uint8ClampedArray(toned);
  const width = source.width;
  const amount = 0.55;
  for (let y = 1; y < source.height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      if (toned[index + 3] < 16) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        let blur = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            blur += toned[((y + offsetY) * width + (x + offsetX)) * 4 + channel];
          }
        }
        blur /= 9;
        sharpened[index + channel] = clampByte(toned[index + channel] + amount * (toned[index + channel] - blur));
      }
    }
  }

  const next = cloneCanvas(source);
  const nextContext = next.getContext("2d");
  if (!nextContext) throw new Error("Could not adjust the photo.");
  nextContext.putImageData(new ImageData(sharpened, width, source.height), 0, 0);
  return next;
}

export function rotateClockwise(source: HTMLCanvasElement): HTMLCanvasElement {
  const next = document.createElement("canvas");
  next.width = source.height;
  next.height = source.width;
  const context = next.getContext("2d");
  if (!context) throw new Error("Could not rotate the photo.");
  context.translate(next.width, 0);
  context.rotate(Math.PI / 2);
  context.drawImage(source, 0, 0);
  return next;
}

export function cropCanvas(source: HTMLCanvasElement, rect: PixelRect): HTMLCanvasElement {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const width = Math.max(1, Math.min(source.width - x, Math.round(rect.w)));
  const height = Math.max(1, Math.min(source.height - y, Math.round(rect.h)));
  const next = document.createElement("canvas");
  next.width = width;
  next.height = height;
  const context = next.getContext("2d");
  if (!context) throw new Error("Could not crop the photo.");
  context.drawImage(source, x, y, width, height, 0, 0, width, height);
  return next;
}

export function flattenOnWhite(source: HTMLCanvasElement): HTMLCanvasElement {
  const next = document.createElement("canvas");
  next.width = source.width;
  next.height = source.height;
  const context = next.getContext("2d");
  if (!context) throw new Error("Could not flatten the photo.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, next.width, next.height);
  context.drawImage(source, 0, 0);
  return next;
}

function fillAverage(data: Uint8ClampedArray): void {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    red += data[index];
    green += data[index + 1];
    blue += data[index + 2];
    count += 1;
  }
  const averageRed = count ? red / count : 0;
  const averageGreen = count ? green / count : 0;
  const averageBlue = count ? blue / count : 0;
  for (let index = 0; index < data.length; index += 4) {
    data[index] = averageRed;
    data[index + 1] = averageGreen;
    data[index + 2] = averageBlue;
    data[index + 3] = 255;
  }
}

export function redactRect(canvas: HTMLCanvasElement, rect: PixelRect): void {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const width = Math.min(canvas.width - x, Math.floor(rect.w));
  const height = Math.min(canvas.height - y, Math.floor(rect.h));
  if (width < 2 || height < 2) return;

  const image = context.getImageData(x, y, width, height);
  const data = image.data;
  const block = Math.max(16, Math.floor(Math.min(width, height) / 3));
  if (width < block * 2 || height < block * 2) {
    fillAverage(data);
  } else {
    for (let blockY = 0; blockY < height; blockY += block) {
      for (let blockX = 0; blockX < width; blockX += block) {
        const blockWidth = Math.min(block, width - blockX);
        const blockHeight = Math.min(block, height - blockY);
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;
        for (let py = 0; py < blockHeight; py += 1) {
          for (let px = 0; px < blockWidth; px += 1) {
            const index = ((blockY + py) * width + (blockX + px)) * 4;
            red += data[index];
            green += data[index + 1];
            blue += data[index + 2];
            count += 1;
          }
        }
        const averageRed = red / count;
        const averageGreen = green / count;
        const averageBlue = blue / count;
        for (let py = 0; py < blockHeight; py += 1) {
          for (let px = 0; px < blockWidth; px += 1) {
            const index = ((blockY + py) * width + (blockX + px)) * 4;
            data[index] = averageRed;
            data[index + 1] = averageGreen;
            data[index + 2] = averageBlue;
            data[index + 3] = 255;
          }
        }
      }
    }
  }
  context.putImageData(image, x, y);
}

export function centeredCrop(width: number, height: number, ratio: number | null): PixelRect {
  if (!ratio) {
    return { x: width * 0.08, y: height * 0.08, w: width * 0.84, h: height * 0.84 };
  }
  let cropWidth = width * 0.92;
  let cropHeight = cropWidth / ratio;
  if (cropHeight > height * 0.92) {
    cropHeight = height * 0.92;
    cropWidth = cropHeight * ratio;
  }
  return {
    x: (width - cropWidth) / 2,
    y: (height - cropHeight) / 2,
    w: cropWidth,
    h: cropHeight,
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Could not export the photo."));
        else resolve(blob);
      },
      type,
      quality,
    );
  });
}

function scaleCanvas(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const next = document.createElement("canvas");
  next.width = Math.max(1, Math.round(source.width * scale));
  next.height = Math.max(1, Math.round(source.height * scale));
  const context = next.getContext("2d");
  if (!context) throw new Error("Could not resize the photo.");
  context.drawImage(source, 0, 0, next.width, next.height);
  return next;
}

export function canvasHasTransparency(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < data.length; index += 16) {
    if (data[index] < 250) return true;
  }
  return false;
}

export async function exportForListing(canvas: HTMLCanvasElement, transparent: boolean): Promise<Blob> {
  if (transparent && canvasHasTransparency(canvas)) {
    const png = await canvasToBlob(canvas, "image/png");
    if (png.size > MAX_IMAGE_BYTES) {
      throw new Error("The PNG is larger than 10 MB. Choose a white background to save a smaller JPEG.");
    }
    return png;
  }

  const limit = MAX_IMAGE_BYTES - 64 * 1024;
  let current = canvas;
  let blob = await canvasToBlob(current, "image/jpeg", JPEG_QUALITY);
  for (const quality of [JPEG_QUALITY, 0.85, 0.78, 0.7, 0.6]) {
    blob = await canvasToBlob(current, "image/jpeg", quality);
    if (blob.size <= limit) return blob;
  }

  while (blob.size > limit && Math.max(current.width, current.height) > LISTING_LONG_SIDE) {
    const longSide = Math.max(current.width, current.height);
    const nextLong = Math.max(LISTING_LONG_SIDE, Math.round(longSide * 0.85));
    current = scaleCanvas(current, nextLong / longSide);
    blob = await canvasToBlob(current, "image/jpeg", 0.85);
  }

  if (blob.size > MAX_IMAGE_BYTES) {
    blob = await canvasToBlob(current, "image/jpeg", 0.55);
  }
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error("The edited photo is still larger than 10 MB.");
  }
  return blob;
}
