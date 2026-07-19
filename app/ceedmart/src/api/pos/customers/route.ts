import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createCustomersWorkflow } from "@medusajs/core-flows"
import type { ICustomerModuleService } from "@medusajs/framework/types"

// POS customer signup at checkout. Idempotent: if a customer with the
// same phone or email already exists, we return that record instead of
// creating a duplicate. This lets the cashier type freely without
// worrying about existing customers.
//
// Match order:
//   1. exact email (case-insensitive)
//   2. exact phone
// First match wins. New customers are created without an account
// (has_account defaults to false) so they can log in later via the
// storefront if they want.

type CreateBody = {
  first_name?: string
  last_name?: string
  phone?: string
  email?: string
}

const normPhone = (v?: string | null): string | null => {
  if (!v) return null
  return v.replace(/\s+/g, "").trim() || null
}
const normEmail = (v?: string | null): string | null => {
  if (!v) return null
  return v.trim().toLowerCase() || null
}

export const POST = async (
  req: AuthenticatedMedusaRequest<CreateBody>,
  res: MedusaResponse
) => {
  const body = req.body || ({} as CreateBody)
  const email = normEmail(body.email)
  const phone = normPhone(body.phone)
  const firstName = body.first_name?.trim() || null
  const lastName = body.last_name?.trim() || null

  if (!email && !phone) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "phone or email is required"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Match by email first, then phone. Both queries are cheap; we skip
  // the second when the first hits.
  const findByEmail = async () => {
    if (!email) return null
    const { data } = await query.graph({
      entity: "customer",
      fields: ["id", "email", "phone", "first_name", "last_name", "has_account"],
      filters: { email },
      pagination: { skip: 0, take: 1 },
    })
    return (data as any[])[0] ?? null
  }
  const findByPhone = async () => {
    if (!phone) return null
    const { data } = await query.graph({
      entity: "customer",
      fields: ["id", "email", "phone", "first_name", "last_name", "has_account"],
      filters: { phone },
      pagination: { skip: 0, take: 1 },
    })
    return (data as any[])[0] ?? null
  }

  let match = await findByEmail()
  if (!match) match = await findByPhone()

  if (match) {
    return res.json({
      customer: match,
      created: false,
    })
  }

  // No match — create a new customer. Attaches phone + email + name if
  // provided. has_account stays false; the customer can register via
  // the storefront later using the same phone/email.
  const { result: created } = await createCustomersWorkflow(req.scope).run({
    input: {
      customersData: [
        {
          email: email ?? undefined,
          phone: phone ?? undefined,
          first_name: firstName ?? undefined,
          last_name: lastName ?? undefined,
        } as any,
      ],
    },
  })
  const newCustomer = Array.isArray(created) ? created[0] : created

  // Re-fetch through query.graph so the response shape matches the
  // match path exactly (createCustomersWorkflow returns a slightly
  // different DTO in some versions).
  const customerSvc: ICustomerModuleService = req.scope.resolve(
    Modules.CUSTOMER
  )
  const full = await customerSvc.retrieveCustomer((newCustomer as any).id)

  return res.status(201).json({
    customer: full,
    created: true,
  })
}
