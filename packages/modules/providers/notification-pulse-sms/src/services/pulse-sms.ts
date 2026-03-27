import {
  Logger,
  NotificationTypes,
} from "@medusajs/framework/types"
import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"

type InjectedDependencies = {
  logger: Logger
}

export interface PulseSmsOptions {
  token: string
  application_id: string
}

const PULSE_NOTIFICATION_URL =
  "https://pulse-notification-service-218803590341.europe-west1.run.app/api/v1/notifications/send-notification"

export class PulseSmsNotificationService extends AbstractNotificationProviderService {
  static identifier = "notification-pulse-sms"
  protected config_: PulseSmsOptions
  protected logger_: Logger

  constructor(
    { logger }: InjectedDependencies,
    options: PulseSmsOptions
  ) {
    super()
    this.config_ = options
    this.logger_ = logger
  }

  static validateOptions(options: Record<any, any>): void | never {
    if (!options.token) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Pulse SMS token is required in the provider's options."
      )
    }
  }

  async send(
    notification: NotificationTypes.ProviderSendNotificationDTO
  ): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    if (!notification) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No notification information provided"
      )
    }

    const body =
      notification.content?.text ||
      notification.content?.html ||
      JSON.stringify(notification.data || {})

    const payload = {
      applicationId: this.config_.application_id,
      channel: "sms",
      data: {
        to: notification.to,
        body,
      },
    }

    try {
      const response = await fetch(PULSE_NOTIFICATION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config_.token}`,
        },
        body: JSON.stringify(payload),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(
          result?.error?.message || result?.message || response.statusText
        )
      }

      this.logger_.info(`Pulse SMS sent to ${notification.to}`)

      return { id: result?.id }
    } catch (error: any) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to send SMS via Pulse: ${error.message}`
      )
    }
  }
}
