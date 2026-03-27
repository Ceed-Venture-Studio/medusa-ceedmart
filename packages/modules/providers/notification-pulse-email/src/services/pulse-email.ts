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

export interface PulseEmailOptions {
  token: string
  application_id: string
  from: string
  alias: string
}

const PULSE_NOTIFICATION_URL =
  "https://pulse-notification-service-218803590341.europe-west1.run.app/api/v1/notifications/send-notification"

export class PulseEmailNotificationService extends AbstractNotificationProviderService {
  static identifier = "notification-pulse-email"
  protected config_: PulseEmailOptions
  protected logger_: Logger

  constructor(
    { logger }: InjectedDependencies,
    options: PulseEmailOptions
  ) {
    super()
    this.config_ = options
    this.logger_ = logger
  }

  static validateOptions(options: Record<any, any>): void | never {
    if (!options.token) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Pulse email token is required in the provider's options."
      )
    }
    if (!options.from) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Sender email (from) is required in the provider's options."
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

    const subject =
      notification.content?.subject ||
      notification.template ||
      "Ceedmart Notification"

    const body =
      notification.content?.html ||
      notification.content?.text ||
      JSON.stringify(notification.data || {})

    const payload = {
      applicationId: this.config_.application_id,
      channel: "email",
      data: {
        alias: this.config_.alias,
        from: notification.from || this.config_.from,
        to: notification.to,
        subject,
        body,
        type: "others",
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

      this.logger_.info(
        `Pulse email sent to ${notification.to}: ${subject}`
      )

      return { id: result?.id }
    } catch (error: any) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to send email via Pulse: ${error.message}`
      )
    }
  }
}
