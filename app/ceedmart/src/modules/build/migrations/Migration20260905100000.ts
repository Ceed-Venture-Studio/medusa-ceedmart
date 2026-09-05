import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260905100000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "build_request" (
        "id" text not null,
        "reference" text not null,
        "customer_id" text null,
        "customer_name" text not null,
        "customer_email" text not null,
        "customer_phone" text null,
        "delivery_state" text null,
        "build_type" text not null default 'desktop',
        "intended_use" text not null,
        "budget_min" numeric null,
        "budget_min_raw" jsonb null,
        "budget_max" numeric null,
        "budget_max_raw" jsonb null,
        "currency_code" text not null default 'ngn',
        "preferred_brands" jsonb null,
        "required_software" jsonb null,
        "performance_notes" text null,
        "portability_needs" text null,
        "required_accessories" jsonb null,
        "needed_by" timestamptz null,
        "notes" text null,
        "status" text not null default 'submitted',
        "assigned_to" text null,
        "awaiting_customer_since" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "build_request_pkey" primary key ("id"),
        constraint "build_request_type_check" check ("build_type" in ('desktop', 'laptop')),
        constraint "build_request_budget_check" check (
          "budget_min" is null or "budget_max" is null or "budget_max" >= "budget_min"
        )
      );
    `)
    this.addSql(`create unique index if not exists "IDX_build_request_reference" on "build_request" ("reference") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_request_status" on "build_request" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_request_email" on "build_request" ("customer_email") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_request_customer" on "build_request" ("customer_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_request_assigned" on "build_request" ("assigned_to") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_request_created" on "build_request" ("created_at") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "build_quote" (
        "id" text not null,
        "request_id" text not null,
        "reference" text not null,
        "current_version_id" text null,
        "version_count" integer not null default 0,
        "status" text not null default 'draft',
        "accepted_version_id" text null,
        "accepted_at" timestamptz null,
        "accepted_by" text null,
        "terms_version_id" text null,
        "rejected_at" timestamptz null,
        "rejection_reason" text null,
        "order_id" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "build_quote_pkey" primary key ("id"),
        constraint "build_quote_status_check" check (
          "status" in ('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded')
        )
      );
    `)
    this.addSql(`create unique index if not exists "IDX_build_quote_reference" on "build_quote" ("reference") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_quote_request" on "build_quote" ("request_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_quote_status" on "build_quote" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_quote_order" on "build_quote" ("order_id") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "build_quote_version" (
        "id" text not null,
        "quote_id" text not null,
        "version" integer not null,
        "line_items" jsonb not null,
        "service_items" jsonb null,
        "subtotal" numeric not null,
        "subtotal_raw" jsonb null,
        "discount_total" numeric not null default 0,
        "discount_total_raw" jsonb null,
        "tax_total" numeric not null default 0,
        "tax_total_raw" jsonb null,
        "delivery_total" numeric not null default 0,
        "delivery_total_raw" jsonb null,
        "total" numeric not null,
        "total_raw" jsonb null,
        "currency_code" text not null default 'ngn',
        "build_days" integer null,
        "warranty_text" text null,
        "cancellation_terms" text null,
        "valid_until" timestamptz not null,
        "change_note" text null,
        "prepared_by" text null,
        "sent_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "build_quote_version_pkey" primary key ("id"),
        constraint "build_quote_version_total_check" check ("total" >= 0)
      );
    `)
    this.addSql(`create index if not exists "IDX_build_quote_version_quote" on "build_quote_version" ("quote_id") where "deleted_at" is null;`)
    this.addSql(`create unique index if not exists "IDX_build_quote_version_number" on "build_quote_version" ("quote_id", "version") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_quote_version_valid" on "build_quote_version" ("valid_until") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "build_order" (
        "id" text not null,
        "request_id" text not null,
        "quote_id" text not null,
        "quote_version_id" text not null,
        "reference" text not null,
        "order_id" text null,
        "order_display_id" integer null,
        "customer_id" text null,
        "configuration_snapshot" jsonb not null,
        "total" numeric not null,
        "total_raw" jsonb null,
        "currency_code" text not null default 'ngn',
        "terms_version_id" text null,
        "status" text not null default 'quote_accepted',
        "build_days" integer null,
        "promised_ready_date" timestamptz null,
        "assigned_to" text null,
        "qa_passed_at" timestamptz null,
        "qa_passed_by" text null,
        "exception_reason" text null,
        "exception_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "build_order_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_build_order_reference" on "build_order" ("reference") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_order_request" on "build_order" ("request_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_order_status" on "build_order" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_order_order" on "build_order" ("order_id") where "deleted_at" is null;`)
    // One build order per accepted quote — a retried acceptance cannot
    // create a second build for the same agreement.
    this.addSql(`create unique index if not exists "IDX_build_order_quote" on "build_order" ("quote_id") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "build_qa_check" (
        "id" text not null,
        "build_order_id" text not null,
        "code" text not null,
        "label" text not null,
        "is_required" boolean not null default true,
        "sort_order" integer not null default 0,
        "result" text not null default 'pending',
        "notes" text null,
        "checked_by" text null,
        "checked_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "build_qa_check_pkey" primary key ("id"),
        constraint "build_qa_check_result_check" check (
          "result" in ('pending', 'passed', 'failed', 'not_applicable')
        )
      );
    `)
    this.addSql(`create index if not exists "IDX_build_qa_check_order" on "build_qa_check" ("build_order_id") where "deleted_at" is null;`)
    this.addSql(`create unique index if not exists "IDX_build_qa_check_code" on "build_qa_check" ("build_order_id", "code") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_qa_check_result" on "build_qa_check" ("result") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "build_milestone" (
        "id" text not null,
        "build_order_id" text not null,
        "status" text not null,
        "occurred_at" timestamptz not null,
        "expected_next_at" timestamptz null,
        "customer_note" text null,
        "internal_note" text null,
        "delay_reason" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "build_milestone_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_build_milestone_order" on "build_milestone" ("build_order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_milestone_status" on "build_milestone" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_milestone_occurred" on "build_milestone" ("occurred_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "build_milestone" cascade;`)
    this.addSql(`drop table if exists "build_qa_check" cascade;`)
    this.addSql(`drop table if exists "build_order" cascade;`)
    this.addSql(`drop table if exists "build_quote_version" cascade;`)
    this.addSql(`drop table if exists "build_quote" cascade;`)
    this.addSql(`drop table if exists "build_request" cascade;`)
  }
}
