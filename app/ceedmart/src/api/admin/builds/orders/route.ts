import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { BUILD_MODULE } from "../../../../modules/build"
import { summarise } from "../../../../lib/build/qa"

// Builds in progress, with QA progress attached (BRD §13).

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(BUILD_MODULE)

  const filters: Record<string, unknown> = {}
  if (typeof req.query.status === "string" && req.query.status) {
    filters.status = req.query.status.split(",")
  }

  const builds = await svc.listBuildOrders(filters, {
    order: { created_at: "DESC" },
    take: Number(req.query.limit) || 50,
  })

  const ids = (builds as any[]).map((b) => b.id)
  const checks = ids.length
    ? await svc.listQaChecks({ build_order_id: ids }, { take: 2000 })
    : []

  const byBuild = new Map<string, any[]>()
  for (const check of checks as any[]) {
    const list = byBuild.get(check.build_order_id) ?? []
    list.push(check)
    byBuild.set(check.build_order_id, list)
  }

  res.json({
    builds: (builds as any[]).map((b) => ({
      ...b,
      qa: summarise(byBuild.get(b.id) ?? []),
    })),
  })
}
