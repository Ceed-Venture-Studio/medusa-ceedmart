export interface S3FileServiceOptions {
  file_url: string
  access_key_id?: string
  secret_access_key?: string
  authentication_method?: "access-key" | "s3-iam-role"
  region: string
  bucket: string
  prefix?: string
  endpoint?: string
  cache_control?: string
  download_file_duration?: number
  additional_client_config?: Record<string, any>
  /**
   * Suppress the `x-amz-acl` header on upload requests. Required when the
   * bucket lives on a provider that doesn't support AWS canned ACLs (GCS S3
   * compatibility rejects the header with "Invalid argument"). Access is
   * expected to be governed by bucket-level IAM instead.
   */
  disable_acl?: boolean
}
