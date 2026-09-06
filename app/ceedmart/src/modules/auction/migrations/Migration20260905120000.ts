import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260905120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "auction" (
        "id" text not null,
        "reference" text not null,
        "title" text not null,
        "description" text null,
        "product_id" text null,
        "variant_id" text null,
        "inventory_item_id" text null,
        "stock_location_id" text null,
        "unit_reference" text null,
        "condition" text not null default 'used',
        "condition_report" text null,
        "known_defects" jsonb null,
        "images" jsonb null,
        "inspection_details" text null,
        "starts_at" timestamptz not null,
        "ends_at" timestamptz not null,
        "original_ends_at" timestamptz null,
        "starting_price" numeric not null,
        "raw_starting_price" jsonb null,
        "min_increment" numeric not null,
        "raw_min_increment" jsonb null,
        "reserve_price" numeric null,
        "raw_reserve_price" jsonb null,
        "buy_now_price" numeric null,
        "raw_buy_now_price" jsonb null,
        "deposit_amount" numeric null,
        "raw_deposit_amount" jsonb null,
        "currency_code" text not null default 'ngn',
        "current_price" numeric null,
        "raw_current_price" jsonb null,
        "bid_count" integer not null default 0,
        "leading_bidder_id" text null,
        "leading_bid_id" text null,
        "last_sequence" integer not null default 0,
        "antisnipe_window_seconds" integer not null default 300,
        "antisnipe_extension_seconds" integer not null default 300,
        "extension_count" integer not null default 0,
        "max_bids_per_bidder" integer null,
        "payment_window_hours" integer not null default 24,
        "fulfilment_options" jsonb null,
        "return_policy_text" text null,
        "warranty_text" text null,
        "terms_version_id" text null,
        "status" text not null default 'draft',
        "cancellation_reason" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "auction_pkey" primary key ("id"),
        constraint "auction_schedule_check" check ("ends_at" > "starts_at"),
        constraint "auction_prices_check" check (
          "starting_price" >= 0 and "min_increment" > 0
        ),
        constraint "auction_condition_check" check (
          "condition" in ('new', 'open_box', 'refurbished', 'used', 'for_parts')
        )
      );
    `)
    this.addSql(`create unique index if not exists "IDX_auction_reference" on "auction" ("reference") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_auction_status" on "auction" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_auction_starts_at" on "auction" ("starts_at") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_auction_ends_at" on "auction" ("ends_at") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_auction_variant" on "auction" ("variant_id") where "deleted_at" is null;`)
    // §8.11 — the unique unit cannot be sold through another checkout while
    // an auction on it is live or awaiting payment. One live auction per
    // inventory unit, enforced by the database.
    this.addSql(`
      create unique index if not exists "IDX_auction_live_unit"
        on "auction" ("inventory_item_id")
       where "inventory_item_id" is not null
         and "deleted_at" is null
         and "status" in ('scheduled', 'live', 'ended', 'awaiting_winner_payment', 'paid', 'fulfilment');
    `)

    this.addSql(`
      create table if not exists "bid" (
        "id" text not null,
        "auction_id" text not null,
        "sequence" integer not null,
        "bidder_id" text not null,
        "bidder_handle" text not null,
        "amount" numeric not null,
        "raw_amount" jsonb null,
        "currency_code" text not null default 'ngn',
        "placed_at" timestamptz not null,
        "kind" text not null default 'bid',
        "voided_at" timestamptz null,
        "voided_by" text null,
        "void_reason" text null,
        "triggered_extension" boolean not null default false,
        "ip_address" text null,
        "user_agent" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "bid_pkey" primary key ("id"),
        constraint "bid_amount_check" check ("amount" > 0)
      );
    `)
    this.addSql(`create index if not exists "IDX_bid_auction" on "bid" ("auction_id");`)
    // THE concurrency guarantee (§8.6). Not partial on deleted_at: bids are
    // never deleted, and a total index is what makes two simultaneous bids
    // resolve to one winner.
    this.addSql(`create unique index if not exists "IDX_bid_auction_sequence" on "bid" ("auction_id", "sequence");`)
    this.addSql(`create index if not exists "IDX_bid_bidder" on "bid" ("bidder_id");`)
    this.addSql(`create index if not exists "IDX_bid_placed_at" on "bid" ("placed_at");`)

    this.addSql(`
      create table if not exists "bidder_eligibility" (
        "id" text not null,
        "customer_id" text not null,
        "email" text null,
        "email_verified_at" timestamptz null,
        "phone" text null,
        "phone_verified_at" timestamptz null,
        "phone_otp_hash" text null,
        "phone_otp_expires_at" timestamptz null,
        "phone_otp_attempts" integer not null default 0,
        "phone_otp_sent_at" timestamptz null,
        "is_barred" boolean not null default false,
        "barred_reason" text null,
        "barred_at" timestamptz null,
        "default_count" integer not null default 0,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "bidder_eligibility_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_bidder_eligibility_customer" on "bidder_eligibility" ("customer_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_bidder_eligibility_barred" on "bidder_eligibility" ("is_barred") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "auction_result" (
        "id" text not null,
        "auction_id" text not null,
        "winning_bid_id" text null,
        "winner_id" text null,
        "winning_amount" numeric null,
        "raw_winning_amount" jsonb null,
        "currency_code" text not null default 'ngn',
        "closed_at" timestamptz not null,
        "reserve_met" boolean not null default false,
        "reserve_price" numeric null,
        "raw_reserve_price" jsonb null,
        "bid_count" integer not null default 0,
        "unique_bidders" integer not null default 0,
        "terms_version_id" text null,
        "superseded_by_offer_id" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "auction_result_pkey" primary key ("id")
      );
    `)
    // The closing job's idempotency marker (§8.8). Total, not partial:
    // a result is never soft-deleted, and ON CONFLICT needs a total index.
    this.addSql(`create unique index if not exists "IDX_auction_result_auction" on "auction_result" ("auction_id");`)
    this.addSql(`create index if not exists "IDX_auction_result_winner" on "auction_result" ("winner_id");`)

    this.addSql(`
      create table if not exists "winner_offer" (
        "id" text not null,
        "auction_id" text not null,
        "bidder_id" text not null,
        "bid_id" text null,
        "amount" numeric not null,
        "raw_amount" jsonb null,
        "currency_code" text not null default 'ngn',
        "rank" integer not null default 1,
        "offered_at" timestamptz not null,
        "expires_at" timestamptz not null,
        "status" text not null default 'pending',
        "paid_at" timestamptz null,
        "order_id" text null,
        "declined_at" timestamptz null,
        "reminders_sent" integer not null default 0,
        "last_reminder_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "winner_offer_pkey" primary key ("id"),
        constraint "winner_offer_status_check" check (
          "status" in ('pending', 'paid', 'expired', 'declined', 'withdrawn')
        )
      );
    `)
    this.addSql(`create index if not exists "IDX_winner_offer_auction" on "winner_offer" ("auction_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_winner_offer_bidder" on "winner_offer" ("bidder_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_winner_offer_status" on "winner_offer" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_winner_offer_expires" on "winner_offer" ("expires_at") where "deleted_at" is null;`)
    // One live offer per auction — the item cannot be promised to two people.
    this.addSql(`create unique index if not exists "IDX_winner_offer_one_pending" on "winner_offer" ("auction_id") where "status" = 'pending' and "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "bidder_deposit" (
        "id" text not null,
        "auction_id" text not null,
        "bidder_id" text not null,
        "amount" numeric not null,
        "raw_amount" jsonb null,
        "currency_code" text not null default 'ngn',
        "status" text not null default 'authorized',
        "authorization_reference" text null,
        "capture_reference" text null,
        "refund_reference" text null,
        "authorized_at" timestamptz null,
        "captured_at" timestamptz null,
        "released_at" timestamptz null,
        "forfeited_at" timestamptz null,
        "forfeit_reason" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "bidder_deposit_pkey" primary key ("id"),
        constraint "bidder_deposit_status_check" check (
          "status" in ('authorized', 'captured', 'released', 'forfeited', 'refunded')
        )
      );
    `)
    this.addSql(`create index if not exists "IDX_bidder_deposit_auction" on "bidder_deposit" ("auction_id") where "deleted_at" is null;`)
    this.addSql(`create unique index if not exists "IDX_bidder_deposit_unique" on "bidder_deposit" ("auction_id", "bidder_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_bidder_deposit_status" on "bidder_deposit" ("status") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "auction_dispute" (
        "id" text not null,
        "auction_id" text not null,
        "raised_by" text null,
        "kind" text not null,
        "description" text not null,
        "evidence" jsonb null,
        "status" text not null default 'open',
        "resolution" text null,
        "resolved_at" timestamptz null,
        "resolved_by" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "auction_dispute_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_auction_dispute_auction" on "auction_dispute" ("auction_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_auction_dispute_status" on "auction_dispute" ("status") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "auction_dispute" cascade;`)
    this.addSql(`drop table if exists "bidder_deposit" cascade;`)
    this.addSql(`drop table if exists "winner_offer" cascade;`)
    this.addSql(`drop table if exists "auction_result" cascade;`)
    this.addSql(`drop table if exists "bidder_eligibility" cascade;`)
    this.addSql(`drop table if exists "bid" cascade;`)
    this.addSql(`drop table if exists "auction" cascade;`)
  }
}
