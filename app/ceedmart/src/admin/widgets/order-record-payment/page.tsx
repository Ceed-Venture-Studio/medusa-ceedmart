import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"
import {
  Button,
  Container,
  Heading,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { useMemo, useState } from "react"

// Record Payment widget on the order detail page sidebar.
//
// Replaces the use of Medusa's built-in "Mark As Paid" button for
// reconciliation flows. That button collapses every recorded payment
// onto "pp_system_default" because the core mark-payment-collection-as-paid
// workflow hardcodes the provider id. This widget hits our
// /admin/orders/:id/record-payment endpoint with an explicit provider,
// so reports can distinguish cash vs card vs bank-transfer vs online.

// Hardcoded for now — the admin doesn't expose a "list payment providers"
// API route by default. These match what we register in medusa-config.ts
// and what the POS store-metadata defaults list. Keep in sync if you add
// more manual providers on the backend.
const RECONCILIATION_METHODS: { id: string; label: string }[] = [
  { id: "pp_cash_manual", label: "Cash" },
  { id: "pp_card_manual", label: "Card" },
  { id: "pp_bank-transfer_manual", label: "Bank Transfer" },
  { id: "pp_online_manual", label: "Online Payment" },
  { id: "pp_other_manual", label: "Other" },
]

const OrderRecordPaymentWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const [providerId, setProviderId] = useState<string>(RECONCILIATION_METHODS[0].id)
  const [submitting, setSubmitting] = useState(false)

  const pendingDifference = useMemo(() => {
    return Number(order.summary?.pending_difference ?? order.total ?? 0)
  }, [order])

  const alreadyCaptured = order.payment_status === "captured"
  const noOutstanding = pendingDifference <= 0
  const disabled = alreadyCaptured || noOutstanding || submitting

  const handleRecord = async () => {
    if (disabled) return
    setSubmitting(true)
    try {
      const res = await fetch(`/admin/orders/${order.id}/record-payment`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_id: providerId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message ?? `Request failed: ${res.status}`)
      }
      const label =
        RECONCILIATION_METHODS.find((m) => m.id === providerId)?.label ?? providerId
      toast.success(`Payment recorded as ${label}`)
      // No invalidate helper available inside widget — caller will refresh
      // when they navigate or refetch. A reload covers the dashboard's
      // cached order summary.
      window.location.reload()
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to record payment")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Record Payment</Heading>
      </div>
      <div className="flex flex-col gap-3 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Reconcile a payment received out-of-band (cash drawer, bank
          confirmation, transfer slip) against this order. The selected
          method is recorded on the payment row.
        </Text>
        {alreadyCaptured ? (
          <Text size="small" className="text-ui-fg-subtle">
            This order is fully captured. No outstanding amount to record.
          </Text>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <Text size="small" weight="plus">
                Method
              </Text>
              <Select value={providerId} onValueChange={setProviderId}>
                <Select.Trigger>
                  <Select.Value placeholder="Select a method" />
                </Select.Trigger>
                <Select.Content>
                  {RECONCILIATION_METHODS.map((m) => (
                    <Select.Item key={m.id} value={m.id}>
                      {m.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <Button
              onClick={handleRecord}
              disabled={disabled}
              isLoading={submitting}
            >
              Record Payment
            </Button>
          </>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.before",
})

export default OrderRecordPaymentWidget
