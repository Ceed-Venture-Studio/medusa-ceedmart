// Feature flags (BRD §15 "a rollback or feature-flag strategy is available").
//
// ── Why this shape ──────────────────────────────────────────────────────
// Three surfaces have to agree on whether a feature is on, and they cannot
// all be redeployed together:
//
//   • backend    — Cloud Run, redeployable in minutes
//   • storefront — Cloud Run, redeployable in minutes
//   • POS        — a Tauri desktop/Android app INSTALLED on cashier
//                  hardware. Shipping a new build to every shop is a
//                  release, not a config change.
//
// So the backend is the single source of truth and publishes flags over
// /store/feature-flags. The POS reads them at boot and on reconnect; it
// never compiles a flag decision in. That way a Phase 3 feature can be
// switched off for every till in the field with one env var change.
//
// Flags are environment variables rather than a database table on purpose:
// a flag that lives in the same database as the feature it guards cannot be
// used to turn that feature off when the database is the problem.

export const FEATURE_FLAGS = {
  /** US Pre-Order listings can be browsed, added to cart and checked out. */
  PREORDER: "preorder",
  /** Custom-build requests and quotes are accepted. */
  CUSTOM_BUILD: "custom_build",
  /** The guided PC/laptop configurator is reachable. Distinct from
   *  CUSTOM_BUILD so the assisted flow can ship first (BRD D-06). */
  BUILD_CONFIGURATOR: "build_configurator",
  /** Auctions are visible and bids are accepted. */
  AUCTION: "auction",
} as const

export type FeatureFlag = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS]

const ENV_PREFIX = "FEATURE_"

// Everything defaults OFF. A flag that defaults on is not a flag — it is a
// release with an undo button nobody has tested.
const DEFAULTS: Record<FeatureFlag, boolean> = {
  [FEATURE_FLAGS.PREORDER]: false,
  [FEATURE_FLAGS.CUSTOM_BUILD]: false,
  [FEATURE_FLAGS.BUILD_CONFIGURATOR]: false,
  [FEATURE_FLAGS.AUCTION]: false,
}

const envKey = (flag: FeatureFlag) => `${ENV_PREFIX}${flag.toUpperCase()}`

/**
 * Whether a flag is on.
 *
 * Read from the environment on every call rather than cached at module load,
 * so a Cloud Run env update takes effect on the next request without a
 * process restart.
 */
export const isEnabled = (flag: FeatureFlag): boolean => {
  const raw = process.env[envKey(flag)]
  if (raw === undefined) return DEFAULTS[flag] ?? false
  return raw === "true" || raw === "1"
}

/** Every flag and its current value — the payload /store/feature-flags
 *  serves to the storefront and POS. */
export const allFlags = (): Record<FeatureFlag, boolean> => {
  const out = {} as Record<FeatureFlag, boolean>
  for (const flag of Object.values(FEATURE_FLAGS)) {
    out[flag] = isEnabled(flag)
  }
  return out
}

/** Guard for API routes: throws a 404-shaped error when the feature is off,
 *  so a disabled endpoint is indistinguishable from one that does not
 *  exist. Leaking "this exists but is disabled" invites probing. */
export const assertEnabled = (flag: FeatureFlag): void => {
  if (!isEnabled(flag)) {
    const err: any = new Error("Not found")
    err.type = "not_found"
    err.status = 404
    throw err
  }
}
