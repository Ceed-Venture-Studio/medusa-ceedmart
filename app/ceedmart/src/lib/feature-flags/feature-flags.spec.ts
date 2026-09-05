import { allFlags, assertEnabled, FEATURE_FLAGS, isEnabled } from "."

describe("feature flags", () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
  })

  it("defaults every flag to off", () => {
    delete process.env.FEATURE_PREORDER
    delete process.env.FEATURE_AUCTION

    expect(isEnabled(FEATURE_FLAGS.PREORDER)).toBe(false)
    expect(isEnabled(FEATURE_FLAGS.AUCTION)).toBe(false)
  })

  it("turns on for 'true' and '1'", () => {
    process.env.FEATURE_PREORDER = "true"
    expect(isEnabled(FEATURE_FLAGS.PREORDER)).toBe(true)

    process.env.FEATURE_PREORDER = "1"
    expect(isEnabled(FEATURE_FLAGS.PREORDER)).toBe(true)
  })

  it("treats any other value as off", () => {
    for (const value of ["", "false", "0", "yes", "TRUE"]) {
      process.env.FEATURE_PREORDER = value
      expect(isEnabled(FEATURE_FLAGS.PREORDER)).toBe(false)
    }
  })

  it("re-reads the environment on every call, so no restart is needed", () => {
    process.env.FEATURE_AUCTION = "false"
    expect(isEnabled(FEATURE_FLAGS.AUCTION)).toBe(false)

    process.env.FEATURE_AUCTION = "true"
    expect(isEnabled(FEATURE_FLAGS.AUCTION)).toBe(true)
  })

  it("keeps the configurator flag independent of custom builds", () => {
    // D-06 — assisted requests ship before the guided builder.
    process.env.FEATURE_CUSTOM_BUILD = "true"
    process.env.FEATURE_BUILD_CONFIGURATOR = "false"

    expect(isEnabled(FEATURE_FLAGS.CUSTOM_BUILD)).toBe(true)
    expect(isEnabled(FEATURE_FLAGS.BUILD_CONFIGURATOR)).toBe(false)
  })

  it("reports every flag for the published payload", () => {
    const flags = allFlags()

    expect(Object.keys(flags).sort()).toEqual(
      Object.values(FEATURE_FLAGS).sort()
    )
  })

  it("hides a disabled endpoint behind a 404 rather than admitting it exists", () => {
    process.env.FEATURE_AUCTION = "false"

    expect(() => assertEnabled(FEATURE_FLAGS.AUCTION)).toThrow("Not found")
    try {
      assertEnabled(FEATURE_FLAGS.AUCTION)
    } catch (err: any) {
      expect(err.status).toBe(404)
    }
  })

  it("lets an enabled feature through", () => {
    process.env.FEATURE_AUCTION = "true"
    expect(() => assertEnabled(FEATURE_FLAGS.AUCTION)).not.toThrow()
  })
})
