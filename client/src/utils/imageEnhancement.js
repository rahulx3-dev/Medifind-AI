/**
 * Utility functions for fine-angle deskewing and pixel-level sharpening.
 * Native HTML5 Canvas math and convolution with zero external dependencies.
 */

/**
 * Calculates the bounding box dimensions of a rectangle rotated by arbitrary angle in degrees.
 * Ensures the rotated content is not clipped at any angle.
 *
 * @param {number} width - Original width
 * @param {number} height - Original height
 * @param {number} angleInDegrees - Total rotation angle in degrees
 * @returns {{ width: number, height: number }} - Expanded unclipped dimensions
 */
export function calculateRotatedDimensions(width, height, angleInDegrees) {
  const w = Number(width) || 1;
  const h = Number(height) || 1;
  const rad = ((Number(angleInDegrees) || 0) * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));

  const rotW = Math.max(1, Math.round(w * cos + h * sin));
  const rotH = Math.max(1, Math.round(w * sin + h * cos));

  return { width: rotW, height: rotH };
}

/**
 * Combines 90° coarse rotation and fine-angle deskewing into a single total rotation.
 *
 * @param {number} coarseRotation - Rotation in 90° increments (0, 90, 180, 270)
 * @param {number} fineAngle - Fine deskew angle (-10 to +10 degrees)
 * @returns {number} - Combined rotation angle in degrees rounded to 2 decimal places
 */
export function getCombinedRotation(coarseRotation = 0, fineAngle = 0) {
  const coarse = Number(coarseRotation) || 0;
  const fine = Number(fineAngle) || 0;
  return Math.round((coarse + fine) * 100) / 100;
}

/**
 * Applies real pixel sharpening using a 3x3 Laplacian convolution kernel.
 * Includes noise coring deadband to prevent paper grain/sensor noise amplification
 * and strict [0, 255] clamping to safeguard against pixel overflow and halos.
 *
 * @param {ImageData} imageData - Target canvas ImageData to sharpen
 * @param {number} strength - Sharpening intensity (0 to 100). 0 preserves pixels exactly.
 * @returns {ImageData} - The modified (or untouched if strength=0) imageData
 */
export function applySharpening(imageData, strength = 0) {
  if (!imageData || !imageData.data || strength <= 0) {
    return imageData;
  }

  const { width, height, data } = imageData;
  if (width < 3 || height < 3) {
    return imageData;
  }

  // Snapshot the unsharpened source pixels
  const src = new Uint8ClampedArray(data);

  // Map 0..100 strength to safe convolution weight factor [0..0.65]
  const clampedStrength = Math.min(100, Math.max(0, Number(strength) || 0));
  const k = (clampedStrength / 100) * 0.65;
  const coringThreshold = 2.0; // Deadband to suppress subtle paper grain noise

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    const rowPrev = (y - 1) * width;
    const rowNext = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const idx = (rowOffset + x) * 4;
      const idxTop = (rowPrev + x) * 4;
      const idxBottom = (rowNext + x) * 4;
      const idxLeft = (rowOffset + x - 1) * 4;
      const idxRight = (rowOffset + x + 1) * 4;

      // Process R, G, B channels independently (preserve Alpha)
      for (let c = 0; c < 3; c++) {
        const center = src[idx + c];
        const top = src[idxTop + c];
        const bottom = src[idxBottom + c];
        const left = src[idxLeft + c];
        const right = src[idxRight + c];

        // Discrete Laplacian: 4 * center - sum of 4 orthogonal neighbors
        const laplacian = 4 * center - (top + bottom + left + right);

        // Apply sharpening if edge magnitude exceeds noise coring threshold
        if (Math.abs(laplacian) > coringThreshold) {
          const delta = laplacian * k;
          const val = center + delta;
          data[idx + c] = val < 0 ? 0 : val > 255 ? 255 : (val + 0.5) | 0;
        }
      }
    }
  }

  return imageData;
}
