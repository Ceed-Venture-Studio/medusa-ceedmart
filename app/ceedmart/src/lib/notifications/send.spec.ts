import { sendNotification, sendNotifications } from "./send"

const makeContainer = (
  opts: {
    notificationBehaviour?: "ok" | "throw"
    logBehaviour?: "ok" | "throw"
  } = {}
) => {
  const logs: any[] = []
  const sends: any[] = []

  const container: any = {
    resolve: (key: string) => {
      if (key === "notification") {
        return {
          createNotifications: async (payload: any) => {
            sends.push(payload)
            if (opts.notificationBehaviour === "throw") {
              const err: any = new Error("provider rejected")
              err.response = { code: "invalid_recipient" }
              throw err
            }
            return { id: "notif_1" }
          },
        }
      }
      if (key === "notification_log") {
        return {
          createNotificationLogs: async (row: any) => {
            if (opts.logBehaviour === "throw") throw new Error("log db down")
            logs.push(row)
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

  return { container, logs, sends }
}

const base = {
  to: "ops@ceedmart.com",
  channel: "email" as const,
  template: "low-stock-alert",
}

describe("sendNotification", () => {
  it("sends and records a successful attempt with the provider response", async () => {
    const { container, logs, sends } = makeContainer()

    const result = await sendNotification(container, {
      ...base,
      triggerType: "inventory.low_stock",
      resourceId: "inv_1",
      resourceType: "inventory_item",
      content: { subject: "Low stock: Widget" },
    })

    expect(result.status).toBe("sent")
    expect(sends).toHaveLength(1)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      channel: "email",
      template: "low-stock-alert",
      trigger_type: "inventory.low_stock",
      recipient: "ops@ceedmart.com",
      subject: "Low stock: Widget",
      resource_id: "inv_1",
      status: "sent",
    })
    expect(logs[0].provider_response).toEqual({ id: "notif_1" })
  })

  it("records a failure instead of throwing", async () => {
    const { container, logs } = makeContainer({
      notificationBehaviour: "throw",
    })

    const result = await sendNotification(container, base)

    expect(result.status).toBe("failed")
    expect(result.error).toBe("provider rejected")
    expect(logs[0]).toMatchObject({
      status: "failed",
      error_message: "provider rejected",
    })
  })

  it("keeps the provider's error detail, which is where the reason lives", async () => {
    const { container, logs } = makeContainer({
      notificationBehaviour: "throw",
    })

    await sendNotification(container, base)

    expect(logs[0].provider_response).toEqual({ code: "invalid_recipient" })
  })

  it("treats a missing recipient as skipped, not failed", async () => {
    // An order with no phone number is a normal state. Recording it as a
    // failure would bury the real failures.
    const { container, logs, sends } = makeContainer()

    const result = await sendNotification(container, { ...base, to: "" })

    expect(result.status).toBe("skipped")
    expect(sends).toHaveLength(0)
    expect(logs[0]).toMatchObject({ status: "skipped", error_message: "no recipient" })
  })

  it("treats a whitespace-only recipient as missing", async () => {
    const { container, sends } = makeContainer()

    const result = await sendNotification(container, { ...base, to: "   " })

    expect(result.status).toBe("skipped")
    expect(sends).toHaveLength(0)
  })

  it("still sends when the log write fails", async () => {
    // A log we could not write must not break the send it describes.
    const { container, sends } = makeContainer({ logBehaviour: "throw" })

    const result = await sendNotification(container, base)

    expect(result.status).toBe("sent")
    expect(sends).toHaveLength(1)
  })

  it("defaults the attempt counter to 1 and carries an explicit one", async () => {
    const { container, logs } = makeContainer()

    await sendNotification(container, base)
    await sendNotification(container, { ...base, attempt: 3 })

    expect(logs[0].attempt).toBe(1)
    expect(logs[1].attempt).toBe(3)
  })
})

describe("sendNotifications", () => {
  it("logs each channel separately for a multi-channel send", async () => {
    // The e-receipt flow sends to email and SMS together; each needs its own
    // delivery record.
    const { container, logs } = makeContainer()

    const results = await sendNotifications(container, [
      { ...base, channel: "email", to: "buyer@example.com" },
      { ...base, channel: "sms", to: "+2348012345678" },
    ])

    expect(results.map((r) => r.status)).toEqual(["sent", "sent"])
    expect(logs).toHaveLength(2)
    expect(logs.map((l) => l.channel)).toEqual(["email", "sms"])
  })

  it("carries on after one channel fails", async () => {
    const { container, logs } = makeContainer({
      notificationBehaviour: "throw",
    })

    const results = await sendNotifications(container, [
      { ...base, channel: "email", to: "buyer@example.com" },
      { ...base, channel: "sms", to: "+2348012345678" },
    ])

    expect(results).toHaveLength(2)
    expect(logs).toHaveLength(2)
  })
})
