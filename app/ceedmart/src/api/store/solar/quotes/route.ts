import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  validateEmail,
} from "@medusajs/framework/utils"
import { SOLAR_MODULE } from "../../../../modules/solar"
import type { SolarBundle } from "../../../../lib/solar/recommend"
import { sendNotification } from "../../../../lib/notifications/send"

type Body = {
  calculation_id?: string
  selected_tier: SolarBundle["tier"]
  selected_bundle: SolarBundle
  customer_name: string
  customer_email: string
  customer_phone?: string
  customer_location?: string
  notes?: string
}

const SALES_INBOX = "victor@ceedmart.com"

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  const body = req.body || ({} as Body)

  if (!body.customer_name?.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "customer_name is required")
  }
  validateEmail(body.customer_email) // throws on invalid
  if (!body.selected_tier || !body.selected_bundle) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "selected_tier and selected_bundle are required"
    )
  }

  const svc: any = req.scope.resolve(SOLAR_MODULE)

  const quote = await svc.createSolarQuotes({
    calculation_id: body.calculation_id ?? null,
    selected_tier: body.selected_tier,
    selected_bundle: body.selected_bundle,
    customer_name: body.customer_name.trim(),
    customer_email: body.customer_email.trim().toLowerCase(),
    customer_phone: body.customer_phone?.trim() || null,
    customer_location: body.customer_location?.trim() || null,
    notes: body.notes?.trim() || null,
    status: "new",
  })

  // Email sales. Never fail the request if Pulse is down — the quote is
  // already persisted and admin can follow up manually. sendNotification
  // records the attempt and the provider's response either way, so support
  // can tell a missing email from an unsent one (BRD §5.4).
  const sent = await sendNotification(req.scope, {
    to: SALES_INBOX,
    channel: "email",
    template: "solar-quote-request",
    triggerType: "solar.quote_requested",
    resourceId: quote.id,
    resourceType: "solar_quote",
    content: {
      subject: `[Ceedmart Solar] New quote request — ${body.customer_name} (${body.selected_tier})`,
      html: renderEmail(quote, body.selected_bundle),
    },
  })

  if (sent.status === "sent") {
    await svc.updateSolarQuotes({ id: quote.id, email_sent_at: new Date() })
  }

  res.status(201).json({ quote })
}

function renderEmail(quote: any, bundle: SolarBundle): string {
  const fmt = (n: number | null | undefined, ccy: string | null) =>
    n == null ? "—" : `${ccy?.toUpperCase() ?? ""} ${n.toLocaleString()}`
  const lineItem = (label: string, c: SolarBundle["inverter"]) =>
    c
      ? `<li><strong>${label}:</strong> ${escapeHtml(c.title)} × ${c.qty} (${fmt(c.unit_price, c.currency_code)})</li>`
      : `<li><strong>${label}:</strong> —</li>`

  return `<h1>New Solar Quote Request</h1>
<p><strong>Name:</strong> ${escapeHtml(quote.customer_name)}<br/>
<strong>Email:</strong> ${escapeHtml(quote.customer_email)}<br/>
<strong>Phone:</strong> ${escapeHtml(quote.customer_phone || "—")}<br/>
<strong>Location:</strong> ${escapeHtml(quote.customer_location || "—")}</p>

<h2>Selected: ${escapeHtml(bundle.tier.toUpperCase())}</h2>
<ul>
  ${lineItem("Inverter", bundle.inverter)}
  ${lineItem("Battery", bundle.battery)}
  ${lineItem("Panels", bundle.panels)}
</ul>
<p><strong>Bundle total:</strong> ${fmt(bundle.total_price, bundle.currency_code)}</p>

<h3>Sizing rationale</h3>
<ul>${bundle.why.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>

${quote.notes ? `<h3>Customer notes</h3><p>${escapeHtml(quote.notes)}</p>` : ""}

<p style="color:#888;font-size:12px">Quote ID: ${quote.id}${quote.calculation_id ? ` · Calculation: ${quote.calculation_id}` : ""}</p>`
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
