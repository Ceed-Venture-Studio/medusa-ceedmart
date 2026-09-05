# Business Requirements Document

## CeedMart Pre-Orders, Custom Builds, and Auctions

**Document version:** 1.0  
**Status:** Draft for stakeholder review  
**Date:** 4 September 2026  
**Product:** CeedMart Nigeria storefront  
**Primary market:** Nigeria  
**Prepared for:** Product, engineering, operations, finance, customer support, and fulfilment teams

---

## 1. Executive summary

CeedMart will expand beyond its current wholesale and retail catalogue with three new commerce capabilities:

1. **US Pre-Order:** Customers can order eligible products sourced from the United States and receive them in Nigeria within a communicated two-week delivery window.
2. **Custom Builds:** Customers can configure or request tailored products, initially focused on custom desktop PCs and configurable laptops.
3. **Auctions:** CeedMart can list selected products for timed bidding, determine a winner, collect payment, and fulfil the item.

All three capabilities must integrate with CeedMart's existing accounts, Nigerian-naira pricing, cart and checkout experience, delivery-location logic, order management, notifications, support, and administration tools.

The release should make the fulfilment model of every item unmistakable. A customer must always know whether an item is in stock, a US pre-order, a custom build, or an auction item before committing to a transaction.

---

## 2. Business context

CeedMart currently operates as a Nigeria-focused wholesale and bulk marketplace offering food, groceries, solar and power systems, security equipment, computers, accessories, and related products. The new capabilities are intended to broaden product access, serve customers with specialised technology requirements, and create an alternative way to sell scarce, premium, clearance, open-box, or high-demand inventory.

### 2.1 Problem statements

- Nigerian customers may want products available in the US that CeedMart does not hold locally.
- Customers buying PCs and laptops may require specifications that fixed catalogue variants cannot represent.
- Some items are better sold through price discovery than fixed pricing.
- Operations staff need controlled workflows for sourcing, quoting, approvals, payment, tracking, fulfilment, disputes, and exceptions.

### 2.2 Business objectives

- Increase product selection without carrying all inventory locally.
- Generate revenue from international sourcing and logistics.
- Capture higher-value technology purchases through guided configuration and quoting.
- Improve conversion for customers with specialised requirements.
- Monetise limited-stock, premium, clearance, returned, or open-box inventory through auctions.
- Preserve customer trust with transparent prices, timelines, item condition, and transaction rules.

### 2.3 Success metrics

The first 90 days after launch should be measured using:

- Pre-order gross merchandise value and completed-order rate.
- Percentage of pre-orders delivered within the promised window.
- Customs, sourcing, cancellation, and refund exception rates.
- Custom-build requests, quote turnaround time, quote acceptance rate, and gross margin.
- Custom-build completion time and return/rework rate.
- Number of auctions published, bidder participation, bid-to-view ratio, sell-through rate, payment completion rate, and realised price versus reserve.
- Customer-support contacts and disputes per transaction type.
- Overall checkout conversion and payment failure rates.

Numeric targets will be set after an operational baseline is available.

---

## 3. Scope

### 3.1 In scope

- Customer-facing discovery, detail pages, status information, and transaction flows for all three features.
- Account-based tracking and notifications.
- Naira pricing and payment collection.
- Administrative management of eligible products, prices, quotes, configurations, auctions, orders, and exceptions.
- Integration with existing catalogue, customer, cart, checkout, delivery, payment, notification, and order systems.
- Mobile-responsive web experiences.
- Audit logs for business-critical changes.

### 3.2 Out of scope for the initial release

- A third-party seller marketplace.
- Customers creating their own auction listings.
- Peer-to-peer payments or escrow between customers.
- Multi-item combinatorial auctions.
- Live video auctions.
- Automated procurement from every US retailer.
- International delivery destinations outside Nigeria.
- A fully automated compatibility guarantee for every possible PC component.
- Trade-in, financing, instalment lending, or buy-now-pay-later unless separately approved.

---

## 4. Stakeholders and user roles

| Role | Primary responsibilities |
|---|---|
| Customer | Discover products, configure requests, place pre-orders, bid, pay, track, and contact support. |
| Catalogue administrator | Classify products, maintain content, variants, prices, eligibility, and availability. |
| Procurement officer | Validate US availability, purchase pre-orders, update sourcing milestones, and handle substitutions. |
| Custom-build specialist | Review requirements, validate compatibility, prepare quotes, and manage build milestones. |
| Auction administrator | Create auctions, set rules, monitor activity, close or cancel auctions, and handle exceptions. |
| Fulfilment/operations | Receive, inspect, assemble where applicable, dispatch, and record delivery. |
| Finance | Reconcile payments, fees, refunds, duties, and auction settlements. |
| Customer support | Resolve questions, delays, cancellations, bid disputes, and fulfilment issues. |
| System administrator | Manage permissions, integrations, configuration, and audit access. |

Role-based access control must limit each staff member to the functions and data required for their role.

---

## 5. Shared experience and platform requirements

### 5.1 Fulfilment-type classification

Every sellable listing must have exactly one primary commerce type:

- Standard stock
- US pre-order
- Custom build
- Auction

Badges and plain-language labels must show the type on product cards, search results, product pages, cart/order surfaces, receipts, and account history where applicable.

An auction item must not be purchased through the normal cart during an active auction. A custom build must not enter the ordinary cart until a quote is accepted and converted into a payable order. A US pre-order may use the cart only if its delivery promise and special terms remain visible throughout checkout.

### 5.2 Accounts

- Browsing may remain available without signing in.
- Signing in is required to submit a custom-build request, place a bid, accept a quote, or complete payment.
- A verified email address and verified Nigerian phone number are required before bidding.
- Customer accounts must display each transaction type in a single order/activity area with type-specific details.

### 5.3 Money and pricing

- Customer-facing amounts must be displayed in Nigerian naira.
- Internally, the system may store source cost and exchange-rate details in their original currencies.
- All monetary calculations must use integer minor units and server-side validation.
- The applicable product price, fees, taxes, shipping, duty assumptions, discounts, and total must be itemised before payment.
- Historical transaction totals must not change when catalogue prices or exchange rates change.

### 5.4 Notifications

The system must support transactional email and in-app notifications. SMS or WhatsApp may be added where approved. Customers must receive notifications for material events, including payment, sourcing, quote, bid, auction, dispatch, delay, cancellation, refund, and delivery milestones.

Notification delivery attempts, provider responses, and customer-visible messages must be logged.

### 5.5 Administration and auditability

- Authorised staff must be able to search, filter, and export records for each feature.
- Material administrative actions must record actor, timestamp, previous value, new value, and reason where relevant.
- Staff must not be able to alter historical bids or paid order totals.
- Operational notes must be separated into internal-only and customer-visible notes.

---

## 6. Feature A — US Pre-Order

### 6.1 Definition

A US pre-order is an eligible product that CeedMart sources from the United States after receiving a customer's order. The customer is shown a target delivery of two weeks, subject to a precisely defined service-level rule and disclosed exceptions.

### 6.2 Assumed service-level rule

For this draft, **two weeks means 14 calendar days starting after successful payment and sourcing confirmation**. The promise pauses if the customer must approve a price change, substitution, address correction, or other exception. Before launch, operations and legal stakeholders must confirm whether the commitment should instead be 10 business days, an estimate rather than a guarantee, or apply only to selected Nigerian delivery zones.

### 6.3 Customer journey

1. Customer discovers an item marked **Ships from the US**.
2. Product page shows specifications, source/condition, landed price or price basis, order deadline if any, two-week delivery explanation, cancellation terms, warranty, and return eligibility.
3. Customer selects any valid variant and quantity.
4. Cart separates US pre-orders from locally stocked items and shows their different delivery timelines.
5. Checkout captures delivery information, customer acceptance of pre-order terms, and payment.
6. CeedMart confirms source availability and begins procurement.
7. Customer tracks sourcing, international transit, customs/clearance, local dispatch, and delivery.
8. Exceptions trigger customer communication and an appropriate approval, cancellation, refund, or revised timeline flow.

### 6.4 Functional requirements

#### Catalogue and product detail

- Administrators can mark a product/variant as US-pre-order eligible.
- Each listing stores source country, supplier/source reference, expected procurement time, expected international transit time, delivery coverage, item condition, warranty, return policy, and stock/availability verification time.
- The product page displays a prominent pre-order badge and an estimated delivery date calculated for the customer's chosen location.
- The product page clearly states whether import duty, clearing, local delivery, and other charges are included.
- The customer cannot add an unavailable or expired pre-order offer to the cart.

#### Pricing

- The price model must support source price, exchange rate, international shipping, insurance, duty/clearing, local delivery, platform margin, tax, and contingency.
- Administrators can choose either:
  - a locked all-inclusive naira price; or
  - an estimated price requiring final customer approval before procurement.
- The checkout must disclose whether the paid total is final.
- Exchange rates and pricing components used for an order must be snapshotted.
- If a post-payment price increase is permitted, CeedMart must request customer approval; silence cannot be treated as approval.

#### Order and fulfilment

Pre-order statuses must include:

`Draft → Awaiting payment → Paid → Availability check → Sourcing confirmed → Purchased → At US facility → In international transit → Customs/clearance → At Nigeria facility → Out for delivery → Delivered`

Exception terminal states must include:

`Cancelled`, `Refund pending`, `Refunded`, `Delivery exception`, and `Unable to source`.

- Customers see a simplified, understandable version of these milestones.
- Staff can record carrier, tracking reference, estimated milestone dates, evidence/notes, and delay reasons.
- Mixed carts may create separate fulfilment groups while retaining a shared checkout reference.
- The system must prevent locally stocked items from inheriting the pre-order delivery timeline.

#### Cancellation, refund, return, and warranty

- Cancellation rules must change by milestone—for example, cancellation may be unrestricted before sourcing and restricted after supplier purchase.
- Customer-visible terms must be accepted at checkout and versioned against the order.
- Staff can issue full or partial refunds with reason codes.
- Returned items must follow the condition and category-specific policy disclosed before purchase.
- Warranty coverage must identify whether CeedMart, a manufacturer, or a third-party distributor is responsible.

### 6.5 Business rules

- Only authorised staff can publish US pre-order products.
- Quantity limits may be applied by product and customer.
- A delivery estimate is recalculated before checkout but becomes a historical snapshot after payment.
- If availability cannot be confirmed within the configured window, the order moves to an exception queue.
- CeedMart must not silently substitute a brand, model, colour, condition, capacity, keyboard layout, plug type, or other material attribute.
- Any material substitution requires explicit customer approval.
- High-value orders may require additional identity or payment-risk review.

### 6.6 Acceptance criteria

- A customer can identify a US pre-order before opening its product page.
- The product page and checkout both show an estimated delivery date and included cost components.
- The customer must accept the applicable pre-order terms before payment.
- A paid order records an immutable price, exchange-rate snapshot, promised date, and terms version.
- Staff can move an order through sourcing and fulfilment milestones.
- The customer receives a notification at every configured material milestone.
- A delayed or unavailable order enters an exception workflow and cannot appear as normally progressing.
- Mixed local/pre-order carts display separate delivery groups.

---

## 7. Feature B — Custom Builds and Configurable Products

### 7.1 Definition

Custom Builds allow a customer to assemble a compatible product configuration or describe a desired outcome. The initial focus is desktop PCs and laptops, with an architecture that can later support other configurable products.

Two modes are required:

1. **Guided configuration:** Customer selects structured components/options with compatibility validation and a running estimate.
2. **Assisted request:** Customer states a budget, intended use, preferences, and special requirements; a CeedMart specialist prepares a quote.

### 7.2 Customer journey

1. Customer chooses **Build a PC**, **Configure a laptop**, or **Request expert help**.
2. Customer enters intended use, budget, performance expectations, preferences, delivery location, and deadline.
3. In guided mode, the customer selects compatible components/options.
4. The system displays estimated price, compatibility notices, availability, lead time, and included services.
5. Customer saves or submits the configuration.
6. A specialist reviews the request and produces a versioned quote.
7. Customer accepts, rejects, or requests changes.
8. An accepted quote becomes a payable custom-build order.
9. Customer tracks procurement, assembly/configuration, quality assurance, dispatch, and delivery.

### 7.3 PC configuration requirements

The initial PC builder should support:

- Processor/CPU
- Motherboard
- Memory/RAM
- Graphics card/GPU
- Storage
- Power supply
- Case
- CPU cooling
- Case cooling
- Operating system
- Monitor and peripherals
- Networking/connectivity
- Assembly, software setup, data transfer, testing, and warranty options

Compatibility rules should cover at minimum:

- CPU socket and motherboard socket/chipset.
- Supported memory type, speed constraints, slot count, and capacity.
- Case and motherboard form factor.
- GPU dimensions and case clearance.
- Cooler/socket compatibility and physical clearance.
- Power-supply wattage/headroom and required connectors.
- Storage interface and available motherboard connections.
- Operating-system support where known.

Warnings must distinguish between a hard incompatibility that blocks submission and a recommendation that the customer may override after acknowledgement.

### 7.4 Laptop configuration requirements

Depending on manufacturer availability, configurable options may include:

- Brand and model family
- Processor
- Memory
- Storage
- Graphics
- Screen size, resolution, and refresh rate
- Keyboard layout
- Operating system
- Colour
- Battery or charger options
- Accessories, setup, software, and warranty

The interface must not imply that a soldered or manufacturer-fixed laptop component can be changed. Options are driven by actual purchasable variants or services.

### 7.5 Assisted-request requirements

- Customer can submit use case, budget range, preferred brands, applications/games, performance goals, portability needs, visual preferences, required accessories, deadline, and free-text notes.
- Customer may attach reference images or specification documents in a future phase; initial release may use text-only input if file handling is not ready.
- Submission creates a trackable request number.
- Staff can communicate clarifying questions without losing the request history.
- Staff can convert an assisted request into a structured configuration and quote.

### 7.6 Quote requirements

- A quote contains itemised components/services, quantities, unit prices, discounts, taxes/fees, delivery cost, total, expected build time, warranty, validity/expiry time, and terms.
- Quotes are versioned. Changes create a new version without overwriting prior versions.
- Customers can accept, reject, or request revision.
- Only the latest valid quote can be accepted.
- Acceptance records customer identity, timestamp, quote version, configuration snapshot, price, and terms version.
- An accepted quote creates a custom-build order and payment request.
- Price and component substitutions after acceptance require explicit customer approval unless the pre-agreed terms identify a non-material equivalent.

### 7.7 Build order statuses

`Request draft → Submitted → Under review → More information required → Quote ready → Revision requested → Quote accepted → Awaiting payment → Paid → Parts sourcing → Assembly/configuration → Quality assurance → Ready for dispatch → Out for delivery → Delivered`

Terminal/exception states:

`Quote expired`, `Rejected`, `Cancelled`, `Unable to fulfil`, `Refund pending`, and `Refunded`.

### 7.8 Save, share, and repeat

- Signed-in customers can save draft configurations.
- Configurations receive human-readable reference numbers.
- A saved build can be duplicated and modified.
- A shareable read-only link may be added if privacy and expiry controls are implemented.
- Reordering a historical build creates a new request because price and component availability may have changed.

### 7.9 Business rules

- All price and compatibility validations must be repeated on the server.
- Component availability is rechecked when a quote is prepared and when it is accepted.
- Estimates are not binding until an authorised quote is accepted.
- A quote must specify whether ownership of procured components prevents cancellation after a milestone.
- Build warranty and individual component warranties must be clearly distinguished.
- Staff must record quality-assurance results before marking a build ready for dispatch.
- Personal data or files transferred during device setup require separate consent and secure handling procedures.

### 7.10 Acceptance criteria

- A customer can complete a guided configuration without selecting incompatible mandatory components.
- The system explains every blocking compatibility failure.
- A customer can submit an assisted request without knowing component terminology.
- Customers can save a draft and resume it on another signed-in session.
- Staff can issue and revise itemised, expiring quotes.
- Quote acceptance creates an immutable configuration and commercial snapshot.
- Customers can track the build from request through delivery.
- Staff cannot mark an order ready for dispatch without completing the configured QA checklist.

---

## 8. Feature C — Auctions

### 8.1 Definition

CeedMart auctions are platform-owned, timed, ascending-price auctions for selected items. CeedMart is the seller in the initial release. Each auction has a starting price, bid increment, schedule, item condition, fulfilment terms, and an optional reserve price.

### 8.2 Customer journey

1. Customer discovers an upcoming or live auction.
2. Auction page displays product details, condition, images, inspection information, seller, start/end time, starting/current price, minimum next bid, reserve status, bid count, delivery/pickup rules, and payment deadline.
3. Customer signs in and completes email and phone verification.
4. Where configured, customer provides a refundable bidder deposit or payment-method authorisation.
5. Customer accepts auction terms and places a valid bid.
6. System confirms or rejects the bid atomically.
7. Customer sees whether they are leading or have been outbid and receives relevant notifications.
8. At close, the system determines the winner according to server time and auction rules.
9. Winner pays within the configured deadline.
10. CeedMart fulfils the item; if the winner defaults, the configured fallback policy applies.

### 8.3 Auction types in the initial release

- Timed English auction with visible current price.
- Optional hidden reserve price.
- Optional **Buy Now** price, which ends the auction immediately after successful purchase unless bids disable Buy Now under configured rules.

Proxy/max bidding may be deferred. If included, its algorithm and tie-breaking rules must be specified and tested separately.

### 8.4 Auction creation requirements

Authorised administrators can configure:

- Product/item and unique inventory unit.
- Item condition: new, open-box, refurbished, used, or damaged/for parts.
- Condition report, known defects, images, serial/reference number, and inspection details.
- Start and end timestamps in a stored canonical timezone, displayed to customers in local time with timezone label.
- Starting price, minimum increment, optional reserve, optional Buy Now price, and optional bidder deposit.
- Anti-sniping extension settings.
- Bidder eligibility and quantity limits.
- Payment deadline, accepted payment methods, pickup/delivery options, return eligibility, and warranty.
- Terms version and cancellation policy.

Draft auctions require validation and a preview before publication.

### 8.5 Auction states

`Draft → Scheduled → Live → Ended → Awaiting winner payment → Paid → Fulfilment → Completed`

Exception states:

`Reserve not met`, `Cancelled`, `Winner defaulted`, `Offered to next bidder`, `Disputed`, `Refund pending`, and `Refunded`.

### 8.6 Bidding requirements

- Bids are submitted to the server; the client display is not authoritative.
- A bid must be at least the current minimum next bid.
- Bid acceptance must be atomic and safe under simultaneous requests.
- Every bid receives an immutable sequence number and server timestamp.
- A customer cannot bid against themselves merely to increase their own leading price unless proxy bidding explicitly requires it.
- Administrators cannot edit or delete accepted bids. Invalid bids can only be voided through a recorded, permission-controlled process that preserves the audit trail.
- Customer-visible bid history should mask bidder identity, for example `Bidder •••4821`.
- The interface must update the current bid, minimum next bid, bid count, leader state, and remaining time promptly.
- Rate limiting, bot controls, risk checks, and monitoring must protect bid submission.

### 8.7 Anti-sniping

If a valid bid is placed during the configured closing window, the end time extends by the configured duration. The updated end time must be persisted, broadcast to all viewers, and included in notifications. Default values proposed for stakeholder approval are a five-minute window and five-minute extension.

### 8.8 Closing and winner determination

- Server time is authoritative.
- Auction closing must be idempotent and safe if the closing job retries.
- The highest valid bid wins if the reserve is met.
- If equal-value bids are possible, the earliest accepted server timestamp wins.
- The winning amount, bidder, closing time, reserve outcome, and applicable terms are snapshotted.
- Losing bidder deposits or holds must be released according to policy.
- The winner receives a payment deadline and clear next steps.

### 8.9 Winner payment and default

- The payment window is configurable; 24 hours is the proposed default.
- The system sends reminders before expiry.
- Until paid or expired, the unique inventory unit is reserved for the winner.
- If the winner defaults, administrators can apply a disclosed penalty, retain an allowed deposit, offer the item to the next eligible bidder, or relist it.
- The next-bidder offer must be a new time-limited offer and must not silently charge that bidder.

### 8.10 Auction cancellation and disputes

- Auction cancellation after bidding begins requires elevated permission and a reason visible in the audit log.
- Bidders must be notified if an auction is materially edited, extended outside automatic rules, or cancelled.
- Material item-description edits after the first bid should require auction cancellation and relisting.
- A support workflow must capture payment, condition, bid-validity, and fulfilment disputes.

### 8.11 Acceptance criteria

- Customers can distinguish upcoming, live, ended, and cancelled auctions.
- An unverified or ineligible customer cannot place a bid.
- A bid below the minimum is rejected with the new minimum displayed.
- Two concurrent bids cannot both be accepted as the same leading sequence.
- Accepted bids are immutable and auditable.
- Anti-sniping extends the auction exactly according to configuration.
- Closing selects one valid winner when the reserve is met and none when it is not.
- The winner can pay only the snapshotted winning total and applicable charges.
- The unique auction item cannot be sold through another checkout while reserved or fulfilled.
- A winner-default workflow can release or reassign the inventory without deleting transaction history.

---

## 9. Cross-feature user experience requirements

### 9.1 Navigation and discovery

The primary navigation should include clear destinations such as:

- Shop
- Pre-Order from the US
- Build Your Device
- Auctions

Search results should support commerce-type filters. Product cards should display fulfilment type, condition where relevant, current/starting price, estimated timeline, and primary action.

### 9.2 Cart and checkout

- Standard stock and US pre-orders may share a cart but must be separated into fulfilment groups.
- Custom builds enter checkout only through an accepted quote.
- Auction wins use a dedicated payment flow and cannot be added to a normal shopping cart.
- The existing minimum-order policy must be configurable by transaction type. It should not automatically block a valid custom-build payment or auction win.
- Promo-code, free-delivery, and wholesale-discount eligibility must be configurable for each commerce type.

### 9.3 Customer account information architecture

Recommended account sections:

- Orders
- US Pre-Orders
- Custom Builds & Quotes
- Auctions & Bids
- Saved Builds
- Addresses
- Notifications
- Profile and verification

An aggregated activity view may link into each detailed section.

### 9.4 Customer support

- Every record must have a reference number suitable for WhatsApp, email, or phone support.
- Support staff should see a unified customer timeline without gaining unnecessary administrator privileges.
- Automated WhatsApp links should include the relevant reference number when launched from a transaction page.

---

## 10. Data requirements

The following conceptual entities are required. Names do not prescribe the final database design.

### 10.1 Shared entities

- `Customer`
- `Address`
- `Product`
- `ProductVariant`
- `CommerceType`
- `Order`
- `OrderLine`
- `FulfilmentGroup`
- `Payment`
- `Refund`
- `Notification`
- `TermsVersion`
- `AuditEvent`

### 10.2 Pre-order entities

- `PreorderOffer`
- `SourceSupplier`
- `LandedCostSnapshot`
- `PreorderMilestone`
- `TrackingReference`
- `PreorderException`
- `CustomerApproval`

### 10.3 Custom-build entities

- `BuildTemplate`
- `ComponentCategory`
- `ComponentOption`
- `CompatibilityRule`
- `BuildConfiguration`
- `BuildConfigurationItem`
- `BuildRequest`
- `BuildQuote`
- `BuildQuoteVersion`
- `BuildMilestone`
- `QualityAssuranceChecklist`

### 10.4 Auction entities

- `Auction`
- `AuctionInventoryUnit`
- `Bid`
- `BidderEligibility`
- `BidderDepositOrHold`
- `AuctionExtension`
- `AuctionResult`
- `WinnerOffer`
- `AuctionDispute`

### 10.5 Data integrity principles

- Transactions reference immutable commercial snapshots rather than mutable catalogue data alone.
- Status changes use validated transitions.
- All timestamps are stored consistently and rendered with an explicit customer timezone.
- Payment-provider events and background jobs are idempotent.
- Personally identifiable information and payment references are protected and access logged.

---

## 11. Integration requirements

The implementation should integrate with or define adapters for:

- Existing CeedMart catalogue and inventory.
- Authentication, email verification, and phone verification.
- Existing cart, checkout, and order services.
- Nigerian payment gateway(s), including webhook verification, refunds, and payment reconciliation.
- Email and approved SMS/WhatsApp notification services.
- Shipping and tracking providers where available.
- Exchange-rate source for pre-order costing.
- Background job/scheduling infrastructure for reminders, quote expiry, auction activation/closing, payment expiry, and delayed-order checks.
- Analytics and operational reporting.

No external provider should become the sole source of truth for CeedMart transaction state.

---

## 12. Non-functional requirements

### 12.1 Security

- Enforce server-side authentication, authorisation, input validation, rate limits, and anti-automation controls.
- Follow OWASP-aligned practices for sessions, access control, injection prevention, file handling, and secrets.
- Do not store raw payment-card data unless the system is intentionally designed and certified for that scope.
- Verify payment and messaging webhooks cryptographically.
- Require step-up verification for high-risk administrative operations.

### 12.2 Performance and availability

- Core catalogue and product pages should remain usable on common Nigerian mobile connections.
- Bid placement and auction reads require a separately monitored service-level objective.
- Auction close jobs must recover safely from restarts and duplicate execution.
- Heavy custom-builder logic should not block normal storefront performance.

### 12.3 Accessibility and responsiveness

- Meet WCAG 2.1 AA as a target.
- All actions must be keyboard accessible with visible focus and meaningful labels.
- Time-sensitive auction content must not rely on colour alone.
- Mobile screens are the primary design constraint.

### 12.4 Observability

- Structured logs and metrics must cover checkout, payment callbacks, pricing, compatibility evaluation, quotes, bids, auction jobs, notifications, and fulfilment transitions.
- Alerts should detect stuck paid pre-orders, expired quotes not closed, auctions failing to start/end, payment-webhook failures, and notification backlogs.
- Correlation/reference identifiers should link customer, order, payment, quote, auction, and support events.

### 12.5 Privacy and retention

- Collect only information required for fulfilment, fraud prevention, support, and legal obligations.
- Define retention periods for identity verification, bids, quotes, audit records, attachments, and transaction communications.
- Customer-facing policies must cover the new transaction types before launch.

---

## 13. Reporting requirements

Operations and management dashboards should provide:

- Pre-orders by status, age, promised date, source, exception reason, margin, and location.
- Builds by request status, assigned specialist, quote age, quote conversion, component availability, promised date, and margin.
- Auctions by lifecycle state, views, watchers if implemented, unique bidders, bids, reserve outcome, realised price, winner payment state, and disputes.
- Payments, refunds, deposits/holds, outstanding balances, and reconciliation exceptions.
- Downloadable CSV reports subject to staff permissions.

---

## 14. Recommended delivery phases

### Phase 0 — Foundations

- Confirm business policies and legal language.
- Introduce commerce-type classification, terms versioning, status-transition framework, audit logging, notifications, and transaction snapshots.
- Separate fulfilment groups and make the minimum-order rule configurable.

### Phase 1 — US Pre-Order MVP

- Curated administrator-created pre-order catalogue.
- Locked all-inclusive naira pricing.
- Checkout consent and two-week estimate.
- Manual sourcing milestones, tracking, exceptions, notifications, and refunds.

### Phase 2 — Assisted Custom Builds MVP

- Requirements questionnaire, saved request, staff review, versioned quote, acceptance, payment, milestone tracking, and QA checklist.
- Start with expert-created configurations before implementing a full compatibility engine.

### Phase 3 — Guided PC/Laptop Builder

- Component catalogue, compatibility rules, estimates, draft saving, structured quote conversion, and optional shareable builds.

### Phase 4 — Auctions MVP

- Platform-owned timed auctions, verification, manual or gateway-supported bidder deposit, atomic bidding, anti-sniping, closing, winner payment, fulfilment, and audit controls.

### Phase 5 — Optimisation

- Automated supplier feeds, proxy bidding, real-time event delivery, richer logistics integrations, recommendations, saved searches/watchlists, and advanced analytics.

The order above reduces risk: pre-orders reuse conventional commerce patterns, assisted builds validate demand before a complex configurator is built, and auctions launch after payments, identity, inventory locking, jobs, and audit infrastructure are mature.

---

## 15. Definition of done

A feature is ready for production only when:

- Approved business rules and customer terms are implemented.
- Customer, staff, exception, and support journeys are complete.
- Acceptance criteria pass in automated and manual testing.
- Mobile and accessibility checks pass.
- Payment success, failure, duplicate callback, cancellation, refund, and reconciliation paths are tested.
- Role permissions and audit logs are verified.
- Monitoring, alerts, dashboards, and operational runbooks exist.
- Support and operations staff are trained.
- Customer-facing help and policy content is published.
- A rollback or feature-flag strategy is available.

---

## 16. Decisions required before engineering locks scope

| ID | Decision | Recommended default |
|---|---|---|
| D-01 | Meaning and starting point of “two weeks” | 14 calendar days after payment and sourcing confirmation; presented as an estimate until logistics data proves a guarantee is supportable. |
| D-02 | Pre-order price model | Locked, all-inclusive naira price for MVP. |
| D-03 | Pre-order cancellation cutoff | Free cancellation before supplier purchase; policy-based resolution afterward. |
| D-04 | Mixed local/pre-order checkout | One checkout with separate fulfilment groups and timelines. |
| D-05 | Minimum-order policy | Configurable; apply to normal wholesale carts, not custom-build quotes or auction wins. |
| D-06 | Custom-build MVP mode | Launch assisted requests and staff quotes before the guided compatibility builder. |
| D-07 | Custom-build deposit | Require full payment or a configurable non-refundable sourcing deposit after quote acceptance. Finance must choose. |
| D-08 | Auction sellers | CeedMart only for MVP. |
| D-09 | Auction bidding model | Timed ascending auction without proxy bidding for MVP. |
| D-10 | Bidder commitment control | Verified phone/email plus configurable deposit for higher-value auctions. |
| D-11 | Anti-sniping | Extend by five minutes when a valid bid arrives in the final five minutes. |
| D-12 | Winner payment window | 24 hours. |
| D-13 | Winner default policy | Time-limited offer to next eligible bidder or relist; never auto-charge. |
| D-14 | Real-time auction technology | Start with reliable short polling if real-time infrastructure is unavailable; retain server-authoritative atomic bidding. |
| D-15 | Returns for auctions | Item-specific and condition-specific, disclosed before bidding, subject to applicable law. |

---

## 17. Engineering handoff instructions

Before writing production code, engineering should produce:

1. An inventory of the current CeedMart architecture, data models, payment gateway, deployment environment, authentication, notifications, and admin tooling.
2. A gap analysis mapping existing capabilities to every requirement in this BRD.
3. Architecture decision records for commerce-type modelling, transaction snapshots, state machines, auction concurrency, scheduling, and real-time updates.
4. Database migrations and an explicit rollback strategy.
5. API contracts with authentication, authorisation, validation, idempotency, and error semantics.
6. Page/component map for customer and administrator experiences.
7. A milestone plan broken into independently deployable, feature-flagged increments.
8. Automated test plans covering unit, integration, end-to-end, concurrency, payment-webhook, permission, accessibility, and failure-recovery scenarios.

Claude Code should treat this BRD as the business source of truth, but it must inspect the repository before choosing frameworks, table names, APIs, or implementation patterns. Where repository reality conflicts with an assumed design in this document, it should preserve the stated business outcome, document the conflict, and propose the smallest compatible change.

---

## 18. Suggested initial engineering prompt

> Read this BRD completely, then inspect the entire relevant CeedMart repository without changing code. Identify the current architecture, commerce data model, authentication, payments, cart/checkout, order state handling, admin tools, notifications, background jobs, and test setup. Produce: (1) a requirement-to-codebase gap analysis, (2) key risks and unresolved decisions, (3) a proposed architecture, (4) database and API changes, (5) customer/admin page changes, and (6) a phased implementation plan with testable tickets. Do not implement until the plan and open decisions are approved. Do not invent existing APIs, providers, or schemas; cite repository paths for every claim about the current system.

