import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260905110000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "build_component_category" (
        "id" text not null,
        "code" text not null,
        "label" text not null,
        "applies_to" text not null default 'desktop',
        "is_required" boolean not null default true,
        "allows_multiple" boolean not null default false,
        "max_quantity" integer not null default 1,
        "sort_order" integer not null default 0,
        "help_text" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "build_component_category_pkey" primary key ("id"),
        constraint "build_component_category_applies_check" check (
          "applies_to" in ('desktop', 'laptop', 'both')
        )
      );
    `)
    this.addSql(`create unique index if not exists "IDX_build_component_category_code" on "build_component_category" ("code") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_component_category_applies" on "build_component_category" ("applies_to") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "build_component_option" (
        "id" text not null,
        "category_id" text not null,
        "label" text not null,
        "brand" text null,
        "variant_id" text null,
        "product_id" text null,
        "indicative_price" numeric null,
        "indicative_price_raw" jsonb null,
        "currency_code" text not null default 'ngn',
        "attributes" jsonb null,
        "is_fixed" boolean not null default false,
        "model_family" text null,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "build_component_option_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_build_component_option_category" on "build_component_option" ("category_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_component_option_variant" on "build_component_option" ("variant_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_component_option_active" on "build_component_option" ("is_active") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_component_option_family" on "build_component_option" ("model_family") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "build_compatibility_rule" (
        "id" text not null,
        "code" text not null,
        "left_category" text not null,
        "left_attribute" text not null,
        "right_category" text not null,
        "right_attribute" text not null,
        "operator" text not null,
        "severity" text not null default 'blocking',
        "message" text not null,
        "remedy" text null,
        "factor" numeric null,
        "is_active" boolean not null default true,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "build_compatibility_rule_pkey" primary key ("id"),
        constraint "build_compatibility_rule_operator_check" check (
          "operator" in ('equals', 'in', 'lte', 'gte', 'sum_lte', 'count_lte')
        ),
        constraint "build_compatibility_rule_severity_check" check (
          "severity" in ('blocking', 'warning')
        )
      );
    `)
    this.addSql(`create unique index if not exists "IDX_build_compatibility_rule_code" on "build_compatibility_rule" ("code") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_compatibility_rule_left" on "build_compatibility_rule" ("left_category") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_compatibility_rule_right" on "build_compatibility_rule" ("right_category") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_compatibility_rule_active" on "build_compatibility_rule" ("is_active") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "build_configuration" (
        "id" text not null,
        "reference" text not null,
        "customer_id" text null,
        "session_token" text null,
        "name" text null,
        "build_type" text not null default 'desktop',
        "model_family" text null,
        "selections" jsonb not null,
        "estimated_total" numeric null,
        "estimated_total_raw" jsonb null,
        "currency_code" text not null default 'ngn',
        "acknowledged_warnings" jsonb null,
        "submitted_request_id" text null,
        "copied_from_id" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "build_configuration_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_build_configuration_reference" on "build_configuration" ("reference") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_configuration_customer" on "build_configuration" ("customer_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_configuration_session" on "build_configuration" ("session_token") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_configuration_created" on "build_configuration" ("created_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "build_configuration" cascade;`)
    this.addSql(`drop table if exists "build_compatibility_rule" cascade;`)
    this.addSql(`drop table if exists "build_component_option" cascade;`)
    this.addSql(`drop table if exists "build_component_category" cascade;`)
  }
}
