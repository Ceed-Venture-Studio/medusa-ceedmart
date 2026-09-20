// Deduplication of repeated webhook deliveries.
//
// Pulse delivers at-least-once and retries five times; Medusa's event bus
// retries on top. The same charge.success therefore arrives repeatedly as a
// matter of course, and their spec makes dedupe a requirement.
//
// Mirrors alreadyHandled/releaseHandled. Those are private and the provider
// drags in config they do not need, so the rules are exercised against the
// same job_claim contract the real ones call.

const makeClaims = () => {
  const taken = new Set<string>()
  return {
    taken,
    tryClaim: jest.fn(async (scope: string, workId: string, _ttlSeconds?: number) => {
      const key = `${scope}:${workId}`
      if (taken.has(key)) return false // someone already holds it
      taken.add(key)
      return true
    }),
    releaseClaim: jest.fn(async (scope: string, workId: string) => {
      taken.delete(`${scope}:${workId}`)
    }),
  }
}

const alreadyHandled = async (
  container: any,
  transactionRef: string
): Promise<boolean> => {
  if (!transactionRef) return false
  try {
    const claims: any = container?.resolve?.("job_claim")
    if (!claims?.tryClaim) return false
    const won = await claims.tryClaim("pulse-webhook", transactionRef, 86400)
    return !won
  } catch {
    return false
  }
}

const releaseHandled = async (container: any, transactionRef: string) => {
  if (!transactionRef) return
  try {
    const claims: any = container?.resolve?.("job_claim")
    await claims?.releaseClaim?.("pulse-webhook", transactionRef)
  } catch {
    /* expires on its own */
  }
}

const containerWith = (claims: any) => ({ resolve: (k: string) => (k === "job_claim" ? claims : undefined) })

describe("Pulse webhook idempotency", () => {
  it("lets the first delivery through", async () => {
    const claims = makeClaims()
    expect(await alreadyHandled(containerWith(claims), "PSK_9c2b1a7f")).toBe(false)
  })

  it("turns away a repeat of the same TransactionRef", async () => {
    const claims = makeClaims()
    const c = containerWith(claims)
    expect(await alreadyHandled(c, "PSK_9c2b1a7f")).toBe(false)
    expect(await alreadyHandled(c, "PSK_9c2b1a7f")).toBe(true)
    expect(await alreadyHandled(c, "PSK_9c2b1a7f")).toBe(true)
  })

  it("keys on TransactionRef, so a different payment is unaffected", async () => {
    const claims = makeClaims()
    const c = containerWith(claims)
    expect(await alreadyHandled(c, "PSK_aaa")).toBe(false)
    expect(await alreadyHandled(c, "PSK_bbb")).toBe(false)
  })

  it("allows a retry after a failure released the claim", async () => {
    const claims = makeClaims()
    const c = containerWith(claims)
    expect(await alreadyHandled(c, "PSK_retry")).toBe(false)
    // processing failed — the provider hands the claim back before throwing
    await releaseHandled(c, "PSK_retry")
    // the retry must be allowed to do the work, not be eaten as a duplicate
    expect(await alreadyHandled(c, "PSK_retry")).toBe(false)
  })

  it("keeps the claim after success, so a later retry is still a no-op", async () => {
    const claims = makeClaims()
    const c = containerWith(claims)
    expect(await alreadyHandled(c, "PSK_ok")).toBe(false)
    // no release on the success path
    expect(await alreadyHandled(c, "PSK_ok")).toBe(true)
  })

  // Fail OPEN: a duplicate authorisation on an already-authorised session is
  // close to harmless, whereas dropping the only notice that a customer has
  // paid is not.
  it("processes when the claim module is missing", async () => {
    expect(await alreadyHandled({ resolve: () => undefined }, "PSK_x")).toBe(false)
  })

  it("processes when the claim store throws", async () => {
    const c = {
      resolve: () => ({
        tryClaim: async () => {
          throw new Error("database unreachable")
        },
      }),
    }
    expect(await alreadyHandled(c, "PSK_x")).toBe(false)
  })

  it("processes when there is no TransactionRef to key on", async () => {
    const claims = makeClaims()
    expect(await alreadyHandled(containerWith(claims), "")).toBe(false)
    expect(claims.tryClaim).not.toHaveBeenCalled()
  })

  it("scopes claims so an unrelated job cannot collide with a webhook", async () => {
    const claims = makeClaims()
    await claims.tryClaim("auction-close", "PSK_9c2b1a7f", 60)
    // same id, different scope — the webhook still gets through
    expect(await alreadyHandled(containerWith(claims), "PSK_9c2b1a7f")).toBe(false)
  })
})
