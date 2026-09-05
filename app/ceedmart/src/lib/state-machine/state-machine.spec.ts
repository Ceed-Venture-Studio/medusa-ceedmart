import { defineStateMachine, SYSTEM_ACTOR } from "."
import {
  auctionMachine,
  buildOrderMachine,
  preorderMachine,
  solarQuoteMachine,
} from "./machines"

// Minimal container stub — resolve("audit") returns a recorder we can assert
// against, resolve("logger") swallows output.
const makeContainer = () => {
  const rows: any[] = []
  const container: any = {
    resolve: (key: string) => {
      if (key === "audit") {
        return {
          createAuditEvents: async (row: any) => {
            rows.push(row)
            return row
          },
        }
      }
      if (key === "logger") {
        return { error: () => {}, warn: () => {}, info: () => {} }
      }
      throw new Error(`unexpected resolve(${key})`)
    },
  }
  return { container, rows }
}

describe("StateMachine validation", () => {
  const machine = defineStateMachine({
    entityType: "test_entity",
    transitions: {
      a: ["b", "x"],
      b: ["c"],
      c: [],
      x: [],
    },
    terminal: ["c", "x"],
    requireReason: ["x"],
  } as const)

  it("allows a declared transition", () => {
    expect(() => machine.assertTransition("a", "b")).not.toThrow()
  })

  it("rejects a transition that is not declared", () => {
    expect(() => machine.assertTransition("a", "c")).toThrow(
      /Cannot move test_entity from "a" to "c"/
    )
  })

  it("names the legal targets so the operator learns what they can do", () => {
    expect(() => machine.assertTransition("a", "c")).toThrow(
      /Allowed from here: b, x/
    )
  })

  it("rejects an unknown target status", () => {
    expect(() => machine.assertTransition("a", "nope")).toThrow(
      /Unknown test_entity status "nope"/
    )
  })

  it("refuses to move out of a terminal state", () => {
    expect(() => machine.assertTransition("c", "b")).toThrow(
      /terminal status "c"/
    )
  })

  it("rejects a no-op transition", () => {
    expect(() => machine.assertTransition("a", "a")).toThrow(
      /already "a"/
    )
  })

  it("demands a reason where one is configured", () => {
    expect(() => machine.assertTransition("a", "x")).toThrow(
      /requires a reason/
    )
    expect(() =>
      machine.assertTransition("a", "x", "supplier went dark")
    ).not.toThrow()
  })

  it("treats whitespace as no reason at all", () => {
    expect(() => machine.assertTransition("a", "x", "   ")).toThrow(
      /requires a reason/
    )
  })
})

describe("StateMachine audit recording", () => {
  const machine = defineStateMachine({
    entityType: "test_entity",
    transitions: { a: ["b"], b: [] },
  } as const)

  it("writes exactly one audit row per accepted transition", async () => {
    const { container, rows } = makeContainer()

    await machine.transition(container, {
      entityId: "te_1",
      from: "a",
      to: "b",
      actor: { type: "user", id: "usr_1", label: "ops@ceedmart.com" },
      reason: "confirmed by supplier",
      correlationId: "corr_1",
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      entity_type: "test_entity",
      entity_id: "te_1",
      action: "transition",
      from_value: "a",
      to_value: "b",
      actor_type: "user",
      actor_id: "usr_1",
      actor_label: "ops@ceedmart.com",
      reason: "confirmed by supplier",
      correlation_id: "corr_1",
    })
  })

  it("writes nothing when the transition is rejected", async () => {
    const { container, rows } = makeContainer()

    await expect(
      machine.transition(container, { entityId: "te_1", from: "b", to: "a" })
    ).rejects.toThrow()

    expect(rows).toHaveLength(0)
  })

  it("defaults to the system actor for jobs and subscribers", async () => {
    const { container, rows } = makeContainer()

    await machine.transition(container, {
      entityId: "te_1",
      from: "a",
      to: "b",
    })

    expect(rows[0].actor_type).toBe("system")
    expect(SYSTEM_ACTOR.type).toBe("system")
  })

  it("does not fail the transition when the audit write throws", async () => {
    const container: any = {
      resolve: (key: string) => {
        if (key === "audit") {
          return {
            createAuditEvents: async () => {
              throw new Error("db down")
            },
          }
        }
        return { error: () => {} }
      },
    }

    await expect(
      machine.transition(container, { entityId: "te_1", from: "a", to: "b" })
    ).resolves.toBeUndefined()
  })
})

describe("declared machines", () => {
  it("runs the solar funnel forwards only", () => {
    expect(solarQuoteMachine.canTransition("new", "contacted")).toBe(true)
    expect(solarQuoteMachine.canTransition("won", "new")).toBe(false)
    expect(solarQuoteMachine.isTerminal("won")).toBe(true)
  })

  it("keeps the pre-order happy path linear", () => {
    expect(preorderMachine.canTransition("paid", "availability_check")).toBe(
      true
    )
    expect(preorderMachine.canTransition("delivered", "out_for_delivery")).toBe(
      false
    )
  })

  it("closes free pre-order cancellation once the supplier is paid", () => {
    // §6.5 — cancellation is unrestricted before sourcing, restricted after
    // supplier purchase.
    expect(preorderMachine.canTransition("paid", "cancelled")).toBe(true)
    expect(preorderMachine.canTransition("purchased", "cancelled")).toBe(false)
    expect(preorderMachine.canTransition("purchased", "refund_pending")).toBe(
      true
    )
  })

  it("blocks a build reaching dispatch without passing QA", () => {
    expect(
      buildOrderMachine.canTransition("assembly", "ready_for_dispatch")
    ).toBe(false)
    expect(
      buildOrderMachine.canTransition("quality_assurance", "ready_for_dispatch")
    ).toBe(true)
    // QA can bounce a build back for rework.
    expect(buildOrderMachine.canTransition("quality_assurance", "assembly")).toBe(
      true
    )
  })

  it("never lets an auction reopen once ended", () => {
    expect(auctionMachine.canTransition("live", "ended")).toBe(true)
    expect(auctionMachine.canTransition("ended", "live")).toBe(false)
    expect(auctionMachine.canTransition("completed", "fulfilment")).toBe(false)
  })

  it("routes a defaulting winner to the next bidder rather than a charge", () => {
    // §8.9 — the next-bidder offer is a new time-limited offer, so it
    // re-enters the awaiting-payment state rather than jumping to paid.
    expect(
      auctionMachine.canTransition("winner_defaulted", "offered_to_next_bidder")
    ).toBe(true)
    expect(
      auctionMachine.canTransition("offered_to_next_bidder", "paid")
    ).toBe(false)
    expect(
      auctionMachine.canTransition(
        "offered_to_next_bidder",
        "awaiting_winner_payment"
      )
    ).toBe(true)
  })

  it("demands a reason for every auction exception", () => {
    expect(() =>
      auctionMachine.assertTransition("live", "cancelled")
    ).toThrow(/requires a reason/)
  })
})
