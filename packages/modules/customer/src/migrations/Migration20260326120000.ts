import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260326120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'ALTER TABLE IF EXISTS "customer" ADD COLUMN IF NOT EXISTS "pim_id" text NULL;'
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      'ALTER TABLE IF EXISTS "customer" DROP COLUMN IF EXISTS "pim_id";'
    )
  }
}
