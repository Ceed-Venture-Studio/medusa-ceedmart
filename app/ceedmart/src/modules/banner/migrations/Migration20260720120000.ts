import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260720120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "banner" add column if not exists "cta_1_label" text null;`)
    this.addSql(`alter table "banner" add column if not exists "cta_2_url" text null;`)
    this.addSql(`alter table "banner" add column if not exists "cta_2_label" text null;`)
    this.addSql(`alter table "banner" add column if not exists "headline" text null;`)
    this.addSql(`alter table "banner" add column if not exists "subheadline" text null;`)
    this.addSql(`alter table "banner" add column if not exists "primary_color" text null;`)
    this.addSql(`alter table "banner" add column if not exists "secondary_color" text null;`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table "banner" drop column if exists "cta_1_label";`)
    this.addSql(`alter table "banner" drop column if exists "cta_2_url";`)
    this.addSql(`alter table "banner" drop column if exists "cta_2_label";`)
    this.addSql(`alter table "banner" drop column if exists "headline";`)
    this.addSql(`alter table "banner" drop column if exists "subheadline";`)
    this.addSql(`alter table "banner" drop column if exists "primary_color";`)
    this.addSql(`alter table "banner" drop column if exists "secondary_color";`)
  }
}
