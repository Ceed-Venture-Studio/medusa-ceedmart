import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { validateBannerImage } from "../../../../lib/banner/validate-image"
import { uploadBannerImage } from "../../../../lib/banner/upload"

// Multipart upload: field `file` (image) + `slot` (slot key in body or query),
// optional `variant` = desktop (default) | mobile.
// Validates aspect + dims against the slot, uploads to the banner bucket,
// and returns { image_url, image_key, image_width, image_height, image_mime_type }
// for the admin UI to pass into POST /admin/banners.

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const file = (req as any).file as Express.Multer.File | undefined
  if (!file) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "file field required (multipart)")
  }

  const slot_key =
    ((req.body as any)?.slot as string | undefined) ||
    (req.query.slot as string | undefined)
  if (!slot_key) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "slot required (form field or ?slot=)")
  }

  // "mobile" for the phone image of a slot that takes one (Home Hero).
  const variantRaw =
    ((req.body as any)?.variant as string | undefined) ||
    (req.query.variant as string | undefined) ||
    "desktop"
  if (variantRaw !== "desktop" && variantRaw !== "mobile") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `variant must be "desktop" or "mobile"`)
  }

  const validated = validateBannerImage(file.buffer, file.mimetype, slot_key, variantRaw)
  const uploaded = await uploadBannerImage(
    file.buffer,
    file.mimetype,
    variantRaw === "mobile" ? `${slot_key}/mobile` : slot_key
  )

  res.status(200).json({
    image_url: uploaded.url,
    image_key: uploaded.key,
    image_width: validated.width,
    image_height: validated.height,
    image_mime_type: validated.mime_type,
    variant: validated.variant,
    slot: {
      key: validated.slot.key,
      label: validated.slot.label,
      aspect_ratio: validated.spec.aspect_ratio,
      min_width: validated.spec.min_width,
      min_height: validated.spec.min_height,
    },
  })
}
