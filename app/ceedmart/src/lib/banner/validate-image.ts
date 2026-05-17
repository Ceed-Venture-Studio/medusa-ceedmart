import { MedusaError } from "@medusajs/framework/utils"
import { imageSize } from "image-size"
import { getSlot, type BannerSlot } from "./slots"

const ASPECT_TOLERANCE = 0.01 // ±1%
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
])

export type ValidatedImage = {
  width: number
  height: number
  mime_type: string
  slot: BannerSlot
}

/**
 * Validates an uploaded image buffer against a banner slot. Throws
 * MedusaError.INVALID_DATA with a clear message on any failure; caller can
 * propagate the error message back to the admin UI verbatim.
 *
 * Validates: slot key exists, mime type allowed, dimensions parse, min size
 * met, aspect ratio within ±1% of the slot's required aspect.
 */
export function validateBannerImage(
  buffer: Buffer,
  mime_type: string,
  slot_key: string
): ValidatedImage {
  const slot = getSlot(slot_key)
  if (!slot) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unknown slot "${slot_key}". Allowed: ${[...allowedSlotKeys()].join(", ")}`
    )
  }

  if (!ALLOWED_MIME.has(mime_type.toLowerCase())) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Image must be JPEG, PNG, or WebP (got ${mime_type})`
    )
  }

  let dims: { width?: number; height?: number }
  try {
    dims = imageSize(buffer)
  } catch (err: any) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Could not read image dimensions: ${err?.message ?? err}`
    )
  }

  const { width, height } = dims
  if (!width || !height) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Image dimensions could not be determined"
    )
  }

  if (width < slot.min_width || height < slot.min_height) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Image is ${width}×${height}px but slot "${slot.label}" requires at least ${slot.min_width}×${slot.min_height}px`
    )
  }

  const actualAspect = width / height
  const drift = Math.abs(actualAspect - slot.aspect_ratio) / slot.aspect_ratio
  if (drift > ASPECT_TOLERANCE) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Image aspect ratio is ${actualAspect.toFixed(3)} (${width}:${height}); slot "${slot.label}" requires ${slot.aspect_ratio.toFixed(3)} within ±1%`
    )
  }

  return { width, height, mime_type, slot }
}

function* allowedSlotKeys(): Iterable<string> {
  // imported lazily to avoid circular re-export
  const { BANNER_SLOTS } = require("./slots") as typeof import("./slots")
  for (const s of BANNER_SLOTS) yield s.key
}
