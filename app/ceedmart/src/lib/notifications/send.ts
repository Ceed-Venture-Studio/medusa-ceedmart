import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type {
  INotificationModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { NOTIFICATION_LOG_MODULE } from "../../modules/notification-log"

// The single way to send a notification (BRD §5.4).
//
// Every call site used to invoke notification.createNotifications directly
// inside its own try/catch, logging failures to the console. That satisfies
// nobody: when a customer says "I never got the email", support has no way
// to tell whether it was sent, rejected by the provider, or never attempted.
//
// This wrapper does the send and records the outcome — including the
// provider's response — so the question has an answer. It also gives us one
// place to add retry or rate limiting later.
//
// Failures are logged and returned, never thrown. A notification is almost
// never the point of the operation that triggered it; failing a customer's
// checkout because Pulse is down would be the wrong trade.

export type SendArgs = {
  to: string
  channel: "email" | "sms" | "feed"
  template: string
  triggerType?: string
  /** The order / quote / auction this concerns. */
  resourceId?: string | null
  resourceType?: string | null
  /** Links this message to the wider customer journey (BRD §12.4). */
  correlationId?: string | null
  content?: Record<string, unknown>
  data?: Record<string, unknown>
  attempt?: number
}

export type SendResult = {
  status: "sent" | "failed" | "skipped"
  error?: string
  response?: unknown
}

const logAttempt = async (
  container: MedusaContainer,
  args: SendArgs,
  result: SendResult
): Promise<void> => {
  try {
    const logs: any = container.resolve(NOTIFICATION_LOG_MODULE)
    await logs.createNotificationLogs({
      channel: args.channel,
      template: args.template ?? null,
      trigger_type: args.triggerType ?? null,
      recipient: args.to ?? null,
      subject: (args.content?.subject as string) ?? null,
      resource_id: args.resourceId ?? null,
      resource_type: args.resourceType ?? null,
      correlation_id: args.correlationId ?? null,
      status: result.status,
      provider_response: (result.response ?? null) as any,
      error_message: result.error ?? null,
      attempt: args.attempt ?? 1,
    })
  } catch (err: any) {
    // A log we could not write must not break the send it describes.
    try {
      const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
      logger.error(
        `[notifications] failed to log ${args.channel} "${args.template}": ${err?.message ?? err}`
      )
    } catch {
      // Nothing else to do.
    }
  }
}

/**
 * Send a notification and record the attempt.
 *
 * Returns the outcome rather than throwing, so callers can decide whether a
 * failed send matters to them. Most do not.
 */
export const sendNotification = async (
  container: MedusaContainer,
  args: SendArgs
): Promise<SendResult> => {
  // No recipient is a skip, not a failure — an order with no phone number is
  // a normal state, and recording it as failed would bury the real failures.
  if (!args.to?.trim()) {
    const result: SendResult = {
      status: "skipped",
      error: "no recipient",
    }
    await logAttempt(container, args, result)
    return result
  }

  try {
    const notification: INotificationModuleService = container.resolve(
      Modules.NOTIFICATION
    )

    const response = await notification.createNotifications({
      to: args.to,
      channel: args.channel,
      template: args.template,
      trigger_type: args.triggerType,
      resource_id: args.resourceId ?? undefined,
      content: args.content as any,
      data: args.data as any,
    } as any)

    const result: SendResult = { status: "sent", response }
    await logAttempt(container, args, result)
    return result
  } catch (err: any) {
    const message = err?.message ?? String(err)

    try {
      const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
      logger.error(
        `[notifications] ${args.channel} "${args.template}" to ${args.to} failed: ${message}`
      )
    } catch {
      // Nothing else to do.
    }

    const result: SendResult = {
      status: "failed",
      error: message,
      // Providers often attach the useful detail to the error, not the
      // throw site — keep whatever came back.
      response: err?.response ?? err?.body ?? null,
    }
    await logAttempt(container, args, result)
    return result
  }
}

/** Send the same message across several channels, logging each separately.
 *  Used by the e-receipt flow, which goes to email and SMS together. */
export const sendNotifications = async (
  container: MedusaContainer,
  sends: SendArgs[]
): Promise<SendResult[]> => {
  const results: SendResult[] = []
  for (const send of sends) {
    results.push(await sendNotification(container, send))
  }
  return results
}
