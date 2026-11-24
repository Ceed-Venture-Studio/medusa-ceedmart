import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Home Hero carousel: a phone image alongside the desktop one, and the
// badge / highlighted-line text the hero renders. All nullable, so existing
// banners are unaffected.
export class Migration20261119200000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "banner" add column if not exists "mobile_image_url" text null;`)
    this.addSql(`alter table "banner" add column if not exists "mobile_image_key" text null;`)
    this.addSql(`alter table "banner" add column if not exists "mobile_image_width" integer null;`)
    this.addSql(`alter table "banner" add column if not exists "mobile_image_height" integer null;`)
    this.addSql(`alter table "banner" add column if not exists "mobile_image_mime_type" text null;`)
    this.addSql(`alter table "banner" add column if not exists "eyebrow" text null;`)
    this.addSql(`alter table "banner" add column if not exists "headline_highlight" text null;`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table "banner" drop column if exists "mobile_image_url";`)
    this.addSql(`alter table "banner" drop column if exists "mobile_image_key";`)
    this.addSql(`alter table "banner" drop column if exists "mobile_image_width";`)
    this.addSql(`alter table "banner" drop column if exists "mobile_image_height";`)
    this.addSql(`alter table "banner" drop column if exists "mobile_image_mime_type";`)
    this.addSql(`alter table "banner" drop column if exists "eyebrow";`)
    this.addSql(`alter table "banner" drop column if exists "headline_highlight";`)
  }
}
