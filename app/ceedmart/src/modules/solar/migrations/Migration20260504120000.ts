import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260504120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "solar_calculation" (
        "id" text not null,
        "appliances" jsonb not null,
        "total_load_w" integer not null,
        "daily_kwh" real not null,
        "night_kwh" real not null,
        "has_heavy_motors" boolean not null default false,
        "margin_pct" integer not null,
        "recommendations" jsonb null,
        "session_id" text null,
        "sales_channel_id" text null,
        "locale" text null,
        "user_agent" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "solar_calculation_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_solar_calculation_session_id" on "solar_calculation" ("session_id") where "deleted_at" is null;`
    )
    this.addSql(
      `create index if not exists "IDX_solar_calculation_created_at" on "solar_calculation" ("created_at") where "deleted_at" is null;`
    )

    this.addSql(`
      create table if not exists "solar_quote" (
        "id" text not null,
        "calculation_id" text null,
        "selected_tier" text not null,
        "selected_bundle" jsonb not null,
        "customer_name" text not null,
        "customer_email" text not null,
        "customer_phone" text null,
        "customer_location" text null,
        "notes" text null,
        "status" text not null default 'new',
        "email_sent_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "solar_quote_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_solar_quote_status" on "solar_quote" ("status") where "deleted_at" is null;`
    )
    this.addSql(
      `create index if not exists "IDX_solar_quote_customer_email" on "solar_quote" ("customer_email") where "deleted_at" is null;`
    )
    this.addSql(
      `create index if not exists "IDX_solar_quote_created_at" on "solar_quote" ("created_at") where "deleted_at" is null;`
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "solar_quote" cascade;`)
    this.addSql(`drop table if exists "solar_calculation" cascade;`)
  }
}
