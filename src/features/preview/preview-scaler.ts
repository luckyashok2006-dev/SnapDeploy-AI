import { PreviewDevicePreset } from '../../types/preview';

export interface ScaleCalculationResult {
  readonly fitScale: number;
  readonly displayScale: number;
  readonly scaledWidth: number;
  readonly scaledHeight: number;
}

/**
 * Calculates deterministic fit-scale and display-scale for a given preview viewport preset.
 * 
 * Invariants:
 * 1. fitScale never exceeds 1.0 (no unwanted upscaling of logical viewports).
 * 2. Aspect ratio is strictly preserved (width and height scaled by identical factor).
 * 3. User zoom multiplies fitScale cleanly: displayScale = clamp(fitScale * (zoom / 100), minScale, maxScale).
 */
export function calculatePreviewScale(
  preset: PreviewDevicePreset,
  availableWidth: number,
  availableHeight: number,
  userZoomPercent = 100,
  minDisplayScale = 0.1,
  maxDisplayScale = 2.0
): ScaleCalculationResult {
  if (availableWidth <= 0 || availableHeight <= 0 || preset.width <= 0 || preset.height <= 0) {
    return {
      fitScale: 1,
      displayScale: 1,
      scaledWidth: preset.width,
      scaledHeight: preset.height
    };
  }

  // Calculate presentation fit scale constrained to panel boundaries without upscaling
  const widthRatio = availableWidth / preset.width;
  const heightRatio = availableHeight / preset.height;
  const fitScale = Math.min(widthRatio, heightRatio, 1.0);

  // Apply user zoom multiplier
  const effectiveZoom = Math.max(10, userZoomPercent || 100) / 100;
  const rawDisplayScale = fitScale * effectiveZoom;

  // Clamp within safe display limits
  const displayScale = Math.max(minDisplayScale, Math.min(maxDisplayScale, rawDisplayScale));

  const scaledWidth = Math.round(preset.width * displayScale);
  const scaledHeight = Math.round(preset.height * displayScale);

  return {
    fitScale,
    displayScale,
    scaledWidth,
    scaledHeight
  };
}

/**
 * Converts physical screen/pointer coordinates to logical coordinates inside the iframe viewport.
 * 
 * Accounts for:
 * - Scaled preview stage wrapper offset (stageRect.left, stageRect.top)
 * - Presentation displayScale
 * - Preset logical boundaries (clamps to [0, preset.width] and [0, preset.height])
 */
export function translateScreenToLogicalCoordinates(
  screenX: number,
  screenY: number,
  stageRect: { left: number; top: number; width?: number; height?: number },
  displayScale: number,
  preset: PreviewDevicePreset
): { logicalX: number; logicalY: number } {
  const safeScale = displayScale > 0 ? displayScale : 1;
  const relativeX = screenX - stageRect.left;
  const relativeY = screenY - stageRect.top;

  const rawLogicalX = relativeX / safeScale;
  const rawLogicalY = relativeY / safeScale;

  const logicalX = Math.max(0, Math.min(preset.width, Math.round(rawLogicalX)));
  const logicalY = Math.max(0, Math.min(preset.height, Math.round(rawLogicalY)));

  return { logicalX, logicalY };
}
