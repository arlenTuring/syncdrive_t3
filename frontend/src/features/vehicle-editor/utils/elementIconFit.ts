import { resolveDashboardIconUrl } from '../../dashboard/constants/iconLibrary';
import {
  BODY_DISPLAY_HEIGHT,
  BODY_DISPLAY_WIDTH,
} from '../constants/palette';
import { resolveVehicleAssetUrl } from '../constants/assetLibrary';
import type { VehicleElement, VehicleElementPatch } from '../types';
import { fitElementSizeToImage, loadImageAlphaBounds, loadImageNaturalSize } from './fitIconBounds';

export function elementSupportsContentFit(element: VehicleElement): boolean {
  if (element.type === 'body') return true;
  /** 車燈不做自動收斂（避免與手動縮放互搶） */
  return false;
}

/** 回報可視區 metrics 供選取框貼齊（含車燈 alpha 邊界） */
export function elementReportsContentMetrics(element: VehicleElement): boolean {
  if (element.type === 'light') return true;
  return elementSupportsContentFit(element);
}

/** @deprecated 改用 elementSupportsContentFit */
export const elementSupportsIconFit = elementSupportsContentFit;

function bodyDisplaySize(boxW: number, boxH: number): { width: number; height: number } {
  return fitElementSizeToImage(boxW, boxH, BODY_DISPLAY_WIDTH, BODY_DISPLAY_HEIGHT);
}

export function resolveElementIconUrl(element: VehicleElement): string | null {
  if (element.type === 'light') {
    const vehicleSrc = resolveVehicleAssetUrl(element.defaultImage);
    if (vehicleSrc && !element.defaultImage.includes('dashboard-icons')) return vehicleSrc;
    return resolveDashboardIconUrl(element.defaultImage) || null;
  }
  return null;
}

export async function fitElementToContent(
  element: VehicleElement,
): Promise<{ width: number; height: number } | null> {
  if (element.type === 'body') {
    return bodyDisplaySize(element.width, element.height);
  }
  const url = resolveElementIconUrl(element);
  if (!url) return null;
  if (element.type === 'light') {
    const bounds = await loadImageAlphaBounds(url);
    if (bounds) {
      const visW = bounds.right - bounds.left + 1;
      const visH = bounds.bottom - bounds.top + 1;
      return fitElementSizeToImage(element.width, element.height, visW, visH);
    }
  }
  const natural = await loadImageNaturalSize(url);
  return fitElementSizeToImage(element.width, element.height, natural.width, natural.height);
}

/** @deprecated 改用 fitElementToContent */
export const fitElementToIcon = fitElementToContent;

export function shouldAutoFitIcon(_element: VehicleElement, patch: VehicleElementPatch): boolean {
  return 'defaultImage' in patch || 'imageRules' in patch;
}

export async function enrichPatchWithIconFit(
  element: VehicleElement,
  patch: VehicleElementPatch,
): Promise<VehicleElementPatch> {
  if (!shouldAutoFitIcon(element, patch)) return patch;
  const merged = { ...element, ...patch } as VehicleElement;
  if (!elementSupportsContentFit(merged)) return patch;
  try {
    const size = await fitElementToContent(merged);
    return size ? { ...patch, ...size } : patch;
  } catch {
    return patch;
  }
}

export async function fitNewIconElement(element: VehicleElement): Promise<VehicleElement> {
  if (!elementSupportsContentFit(element) && element.type !== 'light') return element;
  try {
    const size = await fitElementToContent(element);
    return size ? ({ ...element, ...size } as VehicleElement) : element;
  } catch {
    return element;
  }
}

export function fitBodyElement(element: VehicleElement): VehicleElement {
  if (element.type !== 'body') return element;
  const size = bodyDisplaySize(element.width, element.height);
  return { ...element, ...size };
}
