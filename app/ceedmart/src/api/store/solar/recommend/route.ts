import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { calculateLoad, type ApplianceInput } from "../../../../lib/solar/calculate"
import { recommend } from "../../../../lib/solar/recommend"
import { SOLAR_MODULE } from "../../../../modules/solar"

type Body = {
  appliances: ApplianceInput[]
  session_id?: string
  locale?: string
}

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  const body = req.body || ({} as Body)
  const appliances = Array.isArray(body.appliances) ? body.appliances : []
  if (!appliances.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "appliances is required")
  }

  const load = calculateLoad(appliances)

  const pk = (req as any).publishable_key_context
  const salesChannelId = pk?.sales_channel_ids?.[0] ?? undefined

  const result = await recommend(req.scope, load, { sales_channel_id: salesChannelId })

  // Persist anonymous calculation for future AI training. Fire-and-forget so
  // the storefront never blocks on logging.
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const svc: any = req.scope.resolve(SOLAR_MODULE)

  let calculation_id: string | null = null
  try {
    const created = await svc.createSolarCalculations({
      appliances,
      total_load_w: load.total_load_w,
      daily_kwh: load.daily_kwh,
      night_kwh: load.night_kwh,
      has_heavy_motors: load.has_heavy_motors,
      margin_pct: load.margin_pct,
      recommendations: result,
      session_id: body.session_id ?? null,
      sales_channel_id: salesChannelId ?? null,
      locale: body.locale ?? null,
      user_agent: (req.headers["user-agent"] as string) ?? null,
    })
    calculation_id = created?.id ?? null
  } catch (err: any) {
    logger.warn(`[solar] failed to persist calculation: ${err?.message ?? err}`)
  }

  res.json({
    calculation_id,
    load,
    ...result,
  })
}
