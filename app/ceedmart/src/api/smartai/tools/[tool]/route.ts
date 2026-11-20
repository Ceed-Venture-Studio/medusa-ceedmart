import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { manageCart, SmartaiBadRequest } from "../../../../lib/smartai/cart"
import { getInitialRecommendations, searchProducts } from "../../../../lib/smartai/products"

// POST /smartai/tools/:tool   { args, shopper_id }
//
// One route per SmartAI shopping tool. The body's `args` is the tool input
// as SmartAI sent it; the response body is the tool's structuredContent and
// goes back to SmartAI unchanged (docs/smartai-shopping-mcp-design.md §2.1).
// Store outcomes — including refusals with `error` beside the cart — are
// 200; only a broken call is 4xx/5xx. Auth: lib/smartai/http.

type Body = { args?: Record<string, unknown>; shopper_id?: string }

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const tool = req.params.tool
  const body = (req.body ?? {}) as Body
  const args = body.args && typeof body.args === "object" ? body.args : {}
  const shopperId = typeof body.shopper_id === "string" ? body.shopper_id.trim() : ""
  const started = Date.now()

  try {
    let out: any
    if (tool === "get_initial_recommendations") {
      out = await getInitialRecommendations(req.scope, args)
    } else if (tool === "search_products") {
      out = await searchProducts(req.scope, args)
    } else if (tool === "manage_cart") {
      if (!shopperId) return res.status(400).json({ message: "shopper_id is required" })
      out = await manageCart(req.scope, shopperId, args)
    } else {
      return res.status(404).json({ message: `Unknown tool "${tool}"` })
    }

    // Shopper id, tool, action and outcome only — no cart contents.
    logger.info(
      `[smartai] ${tool}${args.action ? `:${args.action}` : ""} shopper=${shopperId || "-"} ` +
        `result=${out?.error?.code ?? "ok"} ${Date.now() - started}ms`
    )
    return res.json(out)
  } catch (err: any) {
    if (err instanceof SmartaiBadRequest) {
      return res.status(400).json({ message: err.message })
    }
    logger.error(`[smartai] ${tool} shopper=${shopperId || "-"} failed: ${err?.message ?? err}`)
    return res.status(500).json({ message: "The store could not complete this request" })
  }
}
