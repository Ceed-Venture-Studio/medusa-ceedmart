import {
  authenticate,
  defineMiddlewares,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import multer from "multer"
import { SEARCH_LOG_MODULE } from "../modules/search-log"

// 10 MB cap per banner image — comfortably above the largest hero
// (1920×823 png ~3-4 MB) and below memory thresholds.
const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

const logCustomerSearch = async (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => {
  const q = (req.query.q as string | undefined)?.trim()
  if (!q) return next()

  const originalJson = res.json.bind(res)
  res.json = ((body: any) => {
    setImmediate(() => {
      try {
        const svc: any = req.scope.resolve(SEARCH_LOG_MODULE)
        const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

        const products = Array.isArray(body?.products) ? body.products : []
        const resultIds = products.slice(0, 20).map((p: any) => p.id)

        const auth = (req as any).auth_context
        const pk = (req as any).publishable_key_context

        svc
          .createSearchLogs({
            query: q,
            result_count:
              typeof body?.count === "number" ? body.count : products.length,
            result_ids: resultIds,
            customer_id:
              auth?.actor_type === "customer" ? auth.actor_id : null,
            session_id:
              (req.headers["x-cart-id"] as string | undefined) ||
              (req.headers["x-session-id"] as string | undefined) ||
              null,
            sales_channel_id: pk?.sales_channel_ids?.[0] ?? null,
            region_id:
              ((req as any).filterableFields?.region_id as string) ?? null,
            currency_code:
              ((req as any).filterableFields?.currency_code as string) ?? null,
            filters: (req as any).filterableFields ?? {},
            locale: (req as any).locale ?? null,
            user_agent: (req.headers["user-agent"] as string) ?? null,
          })
          .catch((err: any) => {
            logger.warn(`[search-log] insert failed: ${err?.message ?? err}`)
          })
      } catch (err: any) {
        // never let logging break the request
      }
    })
    return originalJson(body)
  }) as typeof res.json

  return next()
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/pos/*",
      middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
    },
    {
      method: ["GET"],
      matcher: "/store/products",
      middlewares: [logCustomerSearch],
    },
    {
      method: ["POST"],
      matcher: "/admin/banners/upload",
      // multer's RequestHandler type isn't directly assignable to Medusa's
      // middleware type; cast through. Pattern used by Medusa core itself.
      middlewares: [bannerUpload.single("file") as any],
    },
  ],
})
