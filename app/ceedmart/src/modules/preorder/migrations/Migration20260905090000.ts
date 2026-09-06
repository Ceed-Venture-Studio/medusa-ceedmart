import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260905090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "source_supplier" (
        "id" text not null,
        "name" text not null,
        "country_code" text not null default 'us',
        "reference" text null,
        "contact_email" text null,
        "contact_phone" text null,
        "notes" text null,
        "is_active" boolean not null default true,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "source_supplier_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_source_supplier_is_active" on "source_supplier" ("is_active") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_source_supplier_country" on "source_supplier" ("country_code") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "preorder_offer" (
        "id" text not null,
        "product_id" text null,
        "variant_id" text null,
        "supplier_id" text null,
        "source_country_code" text not null default 'us',
        "locked_price" numeric not null,
        "raw_locked_price" jsonb null,
        "currency_code" text not null default 'ngn',
        "cost_components" jsonb null,
        "fx_rate" numeric null,
        "fx_captured_at" timestamptz null,
        "includes_duty" boolean not null default true,
        "includes_clearing" boolean not null default true,
        "includes_local_delivery" boolean not null default true,
        "procurement_days" integer not null default 3,
        "transit_days" integer not null default 7,
        "customs_days" integer not null default 4,
        "total_days_override" integer null,
        "delivery_states" jsonb null,
        "condition" text not null default 'new',
        "condition_notes" text null,
        "warranty_text" text null,
        "warranty_provider" text null,
        "return_policy_text" text null,
        "availability_verified_at" timestamptz null,
        "offer_expires_at" timestamptz null,
        "max_per_order" integer null,
        "max_per_customer" integer null,
        "is_active" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "preorder_offer_pkey" primary key ("id"),
        constraint "preorder_offer_target_check" check (
          ("product_id" is not null and "variant_id" is null)
          or ("product_id" is null and "variant_id" is not null)
        ),
        constraint "preorder_offer_condition_check" check (
          "condition" in ('new', 'open_box', 'refurbished', 'used')
        ),
        -- A non-positive locked price would let an item be pre-ordered free.
        constraint "preorder_offer_price_check" check ("locked_price" > 0),
        -- Estimate legs are calendar days and cannot run backwards.
        constraint "preorder_offer_days_check" check (
          "procurement_days" >= 0 and "transit_days" >= 0 and "customs_days" >= 0
        )
      );
    `)
    this.addSql(`create index if not exists "IDX_preorder_offer_product" on "preorder_offer" ("product_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_preorder_offer_variant" on "preorder_offer" ("variant_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_preorder_offer_supplier" on "preorder_offer" ("supplier_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_preorder_offer_is_active" on "preorder_offer" ("is_active") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_preorder_offer_expires" on "preorder_offer" ("offer_expires_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "preorder_order" (
        "id" text not null,
        "order_id" text not null,
        "order_display_id" integer null,
        "line_item_id" text null,
        "offer_id" text not null,
        "variant_id" text null,
        "quantity" integer not null default 1,
        "unit_price" numeric not null,
        "raw_unit_price" jsonb null,
        "currency_code" text not null default 'ngn',
        "cost_snapshot" jsonb null,
        "fx_rate" numeric null,
        "promised_delivery_date" timestamptz null,
        "estimate_days" integer null,
        "clock_started_at" timestamptz null,
        "paused_at" timestamptz null,
        "paused_days" integer not null default 0,
        "terms_version_id" text null,
        "status" text not null default 'awaiting_payment',
        "exception_reason" text null,
        "exception_at" timestamptz null,
        "carrier" text null,
        "tracking_reference" text null,
        "tracking_url" text null,
        "condition" text null,
        "warranty_text" text null,
        "return_policy_text" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "preorder_order_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_preorder_order_order_id" on "preorder_order" ("order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_preorder_order_offer_id" on "preorder_order" ("offer_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_preorder_order_status" on "preorder_order" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_preorder_order_promised" on "preorder_order" ("promised_delivery_date") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_preorder_order_exception" on "preorder_order" ("exception_at") where "deleted_at" is null;`)
    // One pre-order row per line item, so a retried completion cannot
    // create a duplicate contract for the same purchase.
    this.addSql(`create unique index if not exists "IDX_preorder_order_line_item" on "preorder_order" ("line_item_id") where "line_item_id" is not null and "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "preorder_milestone" (
        "id" text not null,
        "preorder_order_id" text not null,
        "status" text not null,
        "occurred_at" timestamptz not null,
        "expected_next_at" timestamptz null,
        "carrier" text null,
        "tracking_reference" text null,
        "tracking_url" text null,
        "customer_note" text null,
        "internal_note" text null,
        "delay_reason" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "preorder_milestone_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_preorder_milestone_order" on "preorder_milestone" ("preorder_order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_preorder_milestone_status" on "preorder_milestone" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_preorder_milestone_occurred" on "preorder_milestone" ("occurred_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "preorder_customer_approval" (
        "id" text not null,
        "preorder_order_id" text not null,
        "order_id" text null,
        "kind" text not null,
        "description" text not null,
        "previous_value" jsonb null,
        "proposed_value" jsonb null,
        "status" text not null default 'pending',
        "requested_at" timestamptz not null,
        "expires_at" timestamptz null,
        "responded_at" timestamptz null,
        "response_token" text null,
        "responded_by" text null,
        "customer_note" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "preorder_customer_approval_pkey" primary key ("id"),
        constraint "preorder_customer_approval_status_check" check (
          "status" in ('pending', 'approved', 'rejected', 'expired')
        )
      );
    `)
    this.addSql(`create index if not exists "IDX_preorder_approval_order" on "preorder_customer_approval" ("preorder_order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_preorder_approval_status" on "preorder_customer_approval" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_preorder_approval_expires" on "preorder_customer_approval" ("expires_at") where "deleted_at" is null;`)
    this.addSql(`create unique index if not exists "IDX_preorder_approval_token" on "preorder_customer_approval" ("response_token") where "response_token" is not null and "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "preorder_customer_approval" cascade;`)
    this.addSql(`drop table if exists "preorder_milestone" cascade;`)
    this.addSql(`drop table if exists "preorder_order" cascade;`)
    this.addSql(`drop table if exists "preorder_offer" cascade;`)
    this.addSql(`drop table if exists "source_supplier" cascade;`)
  }
}
