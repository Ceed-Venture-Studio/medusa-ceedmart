import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { BUILD_MODULE } from "../../../../../../modules/build"
import { assertResultRecordable, summarise } from "../../../../../../lib/build/qa"
import { actorFromRequest } from "../../../../../../lib/state-machine"
import { buildOrderMachine } from "../../../../../../lib/state-machine/machines"

// Record QA results for a build (BRD §7.9).
//
// Every result is audited with the technician who recorded it, because a QA
// record nobody signed is not a QA record. Failing a check demands a note —
// "it failed" tells the next person nothing.

type Body = {
  code: string
  result: "pending" | "passed" | "failed" | "not_applicable"
  notes?: string
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(BUILD_MODULE)

  const checks = await svc.listQaChecks(
    { build_order_id: req.params.id },
    { order: { sort_order: "ASC" }, take: 100 }
  )

  res.json({ checks, summary: summarise(checks as any[]) })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const buildOrderId = req.params.id
  const body = req.body || ({} as Body)

  assertResultRecordable(body.result, body.notes)

  const svc: any = req.scope.resolve(BUILD_MODULE)

  const [check] = await svc.listQaChecks(
    { build_order_id: buildOrderId, code: body.code },
    { take: 1 }
  )
  if (!check) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `QA check "${body.code}" was not found on this build`
    )
  }

  const actor = actorFromRequest(req)
  const now = new Date()

  await svc.updateQaChecks({
    id: check.id,
    result: body.result,
    notes: body.notes ?? null,
    checked_by: actor.label ?? actor.id ?? null,
    checked_at: body.result === "pending" ? null : now,
  })

  await buildOrderMachine.record(req.scope, {
    entityId: buildOrderId,
    action: "qa.recorded",
    fromValue: check.result,
    toValue: body.result,
    actor,
    reason: body.notes ?? null,
    metadata: { code: body.code, label: check.label },
  })

  const checks = await svc.listQaChecks(
    { build_order_id: buildOrderId },
    { order: { sort_order: "ASC" }, take: 100 }
  )
  const summary = summarise(checks as any[])

  // Stamp the build the moment the last required check passes, so the
  // dispatch gate reads one field rather than re-deriving the checklist.
  const build = await svc.retrieveBuildOrder(buildOrderId).catch(() => null)
  if (build) {
    if (summary.complete && !build.qa_passed_at) {
      await svc.updateBuildOrders({
        id: buildOrderId,
        qa_passed_at: now,
        qa_passed_by: actor.label ?? actor.id ?? null,
      })
    } else if (!summary.complete && build.qa_passed_at) {
      // A check reopened after passing revokes the stamp. Otherwise a
      // failure found late would leave the build still marked QA-passed.
      await svc.updateBuildOrders({
        id: buildOrderId,
        qa_passed_at: null,
        qa_passed_by: null,
      })
    }
  }

  res.json({ checks, summary })
}
