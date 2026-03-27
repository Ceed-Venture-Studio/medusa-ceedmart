import type { CreateCustomerDTO, CustomerDTO } from "@medusajs/framework/types"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { setAuthAppMetadataStep } from "../../auth"
import { validateCustomerAccountCreation } from "../steps/validate-customer-account-creation"
import { createCustomersWorkflow } from "./create-customers"

/**
 * Step to register customer with Pulse Identity Manager.
 * Calls the Pulse API and returns the external pim_id.
 */
type RegisterPulseCustomerInput = {
  firstName: string
  lastName: string
  email: string
  password: string
  phone: string
}

const PULSE_BASE_URL =
  "https://pulse-identity-manager-218803590341.europe-west1.run.app/api/v1"

const registerPulseCustomerStep = createStep(
  "register-pulse-customer",
  async (input: RegisterPulseCustomerInput) => {
    const apiKey = process.env.PULSE_IDENTITY_API_KEY
    const tenantId = process.env.PULSE_IDENTITY_TENANT_ID
    const applicationId = process.env.PULSE_IDENTITY_APP_ID

    if (!apiKey || !tenantId || !applicationId) {
      throw new Error(
        "Missing Pulse Identity configuration. Set PULSE_IDENTITY_API_KEY, PULSE_IDENTITY_TENANT_ID, and PULSE_IDENTITY_APP_ID."
      )
    }

    const url = `${PULSE_BASE_URL}/tenants/${tenantId}/applications/${applicationId}/customers/register`

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        ...input,
        scope: "customer",
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        `Pulse Identity registration failed: ${data?.error?.message || response.statusText}`
      )
    }

    const pimId = data?.payload?.value?.pimId
    if (!pimId) {
      throw new Error(
        "Pulse Identity registration did not return a customer ID"
      )
    }

    return new StepResponse(pimId)
  }
)

/**
 * The details of the customer account to create.
 */
export type CreateCustomerAccountWorkflowInput = {
  /**
   * The ID of the auth identity to attach the customer to.
   */
  authIdentityId: string
  /**
   * The details of the customer to create.
   */
  customerData: CreateCustomerDTO
  /**
   * The password from auth registration, needed for Pulse Identity.
   */
  password?: string
}

export const createCustomerAccountWorkflowId = "create-customer-account"
/**
 * This workflow creates a customer and attaches it to an auth identity. It's used by the
 * [Register Customer Store API Route](https://docs.medusajs.com/api/store#customers_postcustomers).
 *
 * You can create an auth identity first using the [Retrieve Registration JWT Token API Route](https://docs.medusajs.com/api/store#auth_postactor_typeauth_provider_register).
 * Learn more about basic authentication flows in [this documentation](https://docs.medusajs.com/resources/commerce-modules/auth/authentication-route).
 *
 * You can use this workflow within your customizations or your own custom workflows, allowing you to
 * register or create customer accounts within your custom flows.
 *
 * @example
 * const { result } = await createCustomerAccountWorkflow(container)
 * .run({
 *   input: {
 *     authIdentityId: "au_1234",
 *     customerData: {
 *       first_name: "John",
 *       last_name: "Doe",
 *       email: "john.doe@example.com",
 *     }
 *   }
 * })
 *
 * @summary
 *
 * Create or register a customer account.
 */
export const createCustomerAccountWorkflow = createWorkflow(
  createCustomerAccountWorkflowId,
  (
    input: WorkflowData<CreateCustomerAccountWorkflowInput>
  ): WorkflowResponse<CustomerDTO> => {
    validateCustomerAccountCreation(input)

    const pulseInput = transform({ input }, (data) => ({
      firstName: data.input.customerData.first_name || "",
      lastName: data.input.customerData.last_name || "",
      email: data.input.customerData.email || "",
      password: data.input.password || "",
      phone: data.input.customerData.phone || "",
    }))

    const pimId = registerPulseCustomerStep(pulseInput)

    const customerData = transform({ input, pimId }, (data) => {
      return {
        ...data.input.customerData,
        has_account: !!data.input.authIdentityId,
        pim_id: data.pimId,
      }
    })

    const customers = createCustomersWorkflow.runAsStep({
      input: {
        customersData: [customerData],
      },
    })

    const customer = transform(
      customers,
      (customers: CustomerDTO[]) => customers[0]
    )

    setAuthAppMetadataStep({
      authIdentityId: input.authIdentityId,
      actorType: "customer",
      value: customer.id,
    })

    return new WorkflowResponse(customer)
  }
)
