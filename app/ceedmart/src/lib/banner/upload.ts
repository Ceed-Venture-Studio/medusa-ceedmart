import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { MedusaError } from "@medusajs/framework/utils"
import { ulid } from "ulid"

// Direct S3 client for the banner-specific bucket. The Medusa file module
// only supports one provider at a time and that slot is taken by the
// product/CSV upload bucket. Banners use the same HMAC creds but a
// different bucket (banner_ads / banner_ads_dev).

let cachedClient: S3Client | null = null

function getClient(): S3Client {
  if (cachedClient) return cachedClient
  const region = process.env.BANNERS_S3_REGION || process.env.S3_REGION || "auto"
  const endpoint = process.env.BANNERS_S3_ENDPOINT || process.env.S3_ENDPOINT || "https://storage.googleapis.com"
  const accessKeyId = process.env.BANNERS_S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.BANNERS_S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Banner storage not configured — set BANNERS_S3_ACCESS_KEY_ID/SECRET (or S3_ACCESS_KEY_ID/SECRET as fallback)"
    )
  }
  cachedClient = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    // GCS S3-compat doesn't accept the AWS SDK v3 default flexible checksums
    // — disable both. See the file-s3 provider config for the same fix.
    requestChecksumCalculation: "WHEN_REQUIRED" as any,
    responseChecksumValidation: "WHEN_REQUIRED" as any,
  })
  return cachedClient
}

function getBucket(): string {
  const bucket = process.env.BANNERS_S3_BUCKET
  if (!bucket) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "BANNERS_S3_BUCKET env var not set"
    )
  }
  return bucket
}

function publicUrl(bucket: string, key: string): string {
  const base = process.env.BANNERS_S3_FILE_URL || `https://storage.googleapis.com/${bucket}`
  return `${base.replace(/\/+$/, "")}/${key}`
}

function extFromMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg": return "jpg"
    case "image/png": return "png"
    case "image/webp": return "webp"
    default: return "bin"
  }
}

export type UploadedBanner = {
  key: string
  url: string
}

export async function uploadBannerImage(
  buffer: Buffer,
  mime_type: string,
  slot_key: string
): Promise<UploadedBanner> {
  const bucket = getBucket()
  const client = getClient()
  const key = `${slot_key}/${ulid()}.${extFromMime(mime_type)}`

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mime_type,
    CacheControl: "public, max-age=86400",
  }))

  return { key, url: publicUrl(bucket, key) }
}

export async function deleteBannerImage(key: string): Promise<void> {
  const bucket = getBucket()
  const client = getClient()
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}
