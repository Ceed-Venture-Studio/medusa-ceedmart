import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, validateEmail } from "@medusajs/framework/utils"
import { BUILD_MODULE } from "../../../../modules/build"
import { generateReference } from "../../../../lib/build/quotes"
import { sendNotification } from "../../../../lib/notifications/send"
import { FEATURE_FLAGS, assertEnabled } from "../../../../lib/feature-flags"

// Public custom-build request intake (BRD §7.5).
//
// §7.10: "a customer can submit an assisted request without knowing
// component terminology." So this asks what they want to DO with the
// machine and what they can spend — never for a socket type or a wattage.
//
// Structurally the same flow modules/solar already runs in production:
// public submit, persist, notify the specialists, admin picks it up.

const SPECIALIST_INBOX =
  process.env.BUILD_SPECIALIST_EMAIL || "victor@ceedmart.com"

type Body = {
  customer_name: string
  customer_email: string
  customer_phone?: string
  delivery_state?: string
  build_type?: "desktop" | "laptop"
  intended_use: string
  budget_min?: number
  budget_max?: number
  preferred_brands?: string[]
  required_software?: string[]
  performance_notes?: string
  portability_needs?: string
  required_accessories?: string[]
  needed_by?: string
  notes?: string
}

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.CUSTOM_BUILD)

  const body = req.body || ({} as Body)

  if (!body.customer_name?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "customer_name is required"
    )
  }
  validateEmail(body.customer_email) // throws on invalid

  if (!body.intended_use?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Tell us what you'll use the machine for"
    )
  }

  const buildType = body.build_type === "laptop" ? "laptop" : "desktop"

  const min = Number(body.budget_min ?? 0)
  const max = Number(body.budget_max ?? 0)
  if (min && max && max < min) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Your maximum budget can't be lower than your minimum"
    )
  }

  const svc: any = req.scope.resolve(BUILD_MODULE)
  const auth = (req as any).auth_context

  const request = await svc.createBuildRequests({
    reference: generateReference("CB"),
    customer_id: auth?.actor_type === "customer" ? auth.actor_id : null,
    customer_name: body.customer_name.trim(),
    customer_email: body.customer_email.trim().toLowerCase(),
    customer_phone: body.customer_phone?.trim() || null,
    delivery_state: body.delivery_state?.trim() || null,
    build_type: buildType,
    intended_use: body.intended_use.trim(),
    budget_min: min || null,
    budget_max: max || null,
    preferred_brands: body.preferred_brands ?? null,
    required_software: body.required_software ?? null,
    performance_notes: body.performance_notes?.trim() || null,
    portability_needs: body.portability_needs?.trim() || null,
    required_accessories: body.required_accessories ?? null,
    needed_by: body.needed_by ? new Date(body.needed_by) : null,
    notes: body.notes?.trim() || null,
    status: "submitted",
  })

  // Tell the specialists. Never fails the request — the row is saved and
  // the admin queue will surface it regardless.
  const summary = [
    `New custom build request ${request.reference}`,
    ``,
    `Name: ${request.customer_name}`,
    `Email: ${request.customer_email}`,
    `Phone: ${request.customer_phone || "—"}`,
    `State: ${request.delivery_state || "—"}`,
    ``,
    `Type: ${buildType}`,
    `Use: ${request.intended_use}`,
    `Budget: ${min ? `${min / 100}` : "—"} to ${max ? `${max / 100}` : "—"} NGN`,
    request.needed_by ? `Needed by: ${new Date(request.needed_by).toDateString()}` : "",
    request.performance_notes ? `Performance: ${request.performance_notes}` : "",
    request.notes ? `Notes: ${request.notes}` : "",
    ``,
    `— Ceedmart`,
  ]
    .filter(Boolean)
    .join("\n")

  await sendNotification(req.scope, {
    to: SPECIALIST_INBOX,
    channel: "email",
    template: "build-request-received",
    triggerType: "build.request_submitted",
    resourceId: request.id,
    resourceType: "build_request",
    content: {
      subject: `[Ceedmart Builds] ${request.reference} — ${buildType} for ${request.customer_name}`,
      text: summary,
      html: summary.replace(/\n/g, "<br/>"),
    },
  })

  // Acknowledge to the customer with the reference they'll quote at us on
  // WhatsApp (§9.4).
  await sendNotification(req.scope, {
    to: request.customer_email,
    channel: "email",
    template: "build-request-acknowledged",
    triggerType: "build.request_acknowledged",
    resourceId: request.id,
    resourceType: "build_request",
    content: {
      subject: `We've got your build request — ${request.reference}`,
      text:
        `Thanks ${request.customer_name}. One of our build specialists will look at what you need and come back with a quote.\n\n` +
        `Your reference is ${request.reference} — quote it if you contact us.\n\n— Ceedmart`,
    },
  })

  res.status(201).json({
    request: { id: request.id, reference: request.reference, status: request.status },
  })
}
