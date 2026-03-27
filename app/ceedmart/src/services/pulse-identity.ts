const PULSE_BASE_URL =
  "https://pulse-identity-manager-218803590341.europe-west1.run.app/api/v1"

export type PulseCustomerRegisterInput = {
  firstName: string
  lastName: string
  email: string
  password: string
  phone: string
  scope: string
}

export type PulseCustomerResponse = {
  success: boolean
  payload?: {
    message: string
    value: {
      pimId: string
      applicationId: string
      firstName: string
      lastName: string
      email: string
      phone: string | null
      scope: string
      updatedAt: string
    }
  }
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export class PulseIdentityService {
  private apiKey: string
  private tenantId: string
  private applicationId: string

  constructor() {
    this.apiKey = process.env.PULSE_IDENTITY_API_KEY!
    this.tenantId = process.env.PULSE_IDENTITY_TENANT_ID!
    this.applicationId = process.env.PULSE_IDENTITY_APP_ID!

    if (!this.apiKey || !this.tenantId || !this.applicationId) {
      throw new Error(
        "Missing Pulse Identity configuration. Set PULSE_IDENTITY_API_KEY, PULSE_IDENTITY_TENANT_ID, and PULSE_IDENTITY_APP_ID."
      )
    }
  }

  async registerCustomer(
    input: PulseCustomerRegisterInput
  ): Promise<PulseCustomerResponse> {
    const url = `${PULSE_BASE_URL}/tenants/${this.tenantId}/applications/${this.applicationId}/customers/register`

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify(input),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        `Pulse Identity registration failed: ${data?.error?.message || response.statusText}`
      )
    }

    return data as PulseCustomerResponse
  }
}
