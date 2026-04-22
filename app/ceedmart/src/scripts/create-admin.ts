import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createUserAccountWorkflow } from "@medusajs/medusa/core-flows"

/**
 * Create the initial Ceedmart admin user.
 *
 * Idempotent: skips creation if a user with the target email already exists.
 *
 * Run locally:
 *   yarn medusa exec ./src/scripts/create-admin.ts
 *
 * Run in Cloud Run (one-shot):
 *   gcloud run jobs deploy ceedmart-create-admin \
 *     --image=europe-west1-docker.pkg.dev/ceedmart/ceedmart-docker/api:latest \
 *     --command=yarn --args=medusa,exec,./src/scripts/create-admin.ts \
 *     --set-env-vars="$(cat app/ceedmart/.env.production | tr '\n' ',')" \
 *     --region=europe-west1
 *   gcloud run jobs execute ceedmart-create-admin --wait --region=europe-west1
 */
export default async function createAdmin({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const email = process.env.PULSE_IDENTITY_ADMIN_EMAIL || "victor@ceedmart.com"
  const password = process.env.PULSE_IDENTITY_ADMIN_PASSWORD

  if (!password) {
    throw new Error(
      "PULSE_IDENTITY_ADMIN_PASSWORD is not set; cannot create admin user."
    )
  }

  const userModule = container.resolve(Modules.USER)
  const existing = await userModule.listUsers({ email })

  if (existing.length) {
    logger.info(`Admin user ${email} already exists (id=${existing[0].id}); skipping.`)
    return
  }

  await createUserAccountWorkflow(container).run({
    input: {
      authIdentityId: "",
      userData: {
        email,
        first_name: "Ceedmart",
        last_name: "Admin",
      },
    },
  })

  // Attach an emailpass auth identity so the user can sign in.
  const authModule = container.resolve(Modules.AUTH)
  await authModule.register("emailpass", {
    body: { email, password },
  } as any)

  logger.info(`Created admin user ${email}`)
}
