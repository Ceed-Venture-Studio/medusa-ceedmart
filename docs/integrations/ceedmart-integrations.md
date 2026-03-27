# Ceedmart Integration Configuration

> **IMPORTANT:** All secrets must be stored in environment variables, never committed to source control.

---

## 1. Identity (Pulse Identity Service)

Handles authentication for all actor types in Ceedmart.

**Environment Variables:**
```
PULSE_IDENTITY_APP_ID=<see .env>
PULSE_IDENTITY_TENANT_ID=<see .env>
PULSE_IDENTITY_API_KEY=<see .env>
```

**Actor Type Mapping:**

| Medusa Actor Type | Pulse Identity Concept | Description |
|---|---|---|
| `customer` | Tenant Application Customer | Storefront buyers |
| `user` | Tenant User | Admin / Operations staff |

**Auth Flow:**
- Customers authenticate via Pulse Identity as **Tenant Application Customers**
- Admin/Operations users authenticate via Pulse Identity as **Tenant Users**
- Replaces the built-in email/password, Google, and GitHub auth providers

---

## 2. Notifications (Pulse Notification Service)

Handles email and SMS delivery for Ceedmart.

### Email / Push

**Environment Variables:**
```
PULSE_NOTIFICATION_EMAIL_TOKEN=<see .env>
```

- **Provider:** Mailgun (via Pulse)
- **Domain:** pulse-core.xyz
- **Capabilities:** Email, Push notifications

### SMS

**Environment Variables:**
```
PULSE_NOTIFICATION_SMS_TOKEN=<see .env>
```

- **Provider:** Kudisms (via Pulse)
- **Sender ID:** PulseCVS
- **Capabilities:** SMS notifications

**Replaces:** Built-in SendGrid notification provider

---

## 3. Payment (Pulse Payment Service)

**Environment Variables:**
```
PULSE_PAYMENT_API_KEY=<see .env>
PULSE_PAYMENT_AUTH_TOKEN=<see .env>
PULSE_PAYMENT_SERVICE_KEY=<see .env>
```

**Requirements:**
- API Key for service identification
- Authentication token for request signing
- Service Key for transaction verification

**Replaces:** Built-in Stripe payment provider

---

## 4. Fulfillment

**Status:** TBD - Swagger docs pending

**Replaces:** Built-in manual fulfillment provider

---

## Environment File Template

```env
# === Pulse Identity ===
PULSE_IDENTITY_APP_ID=
PULSE_IDENTITY_TENANT_ID=
PULSE_IDENTITY_API_KEY=

# === Pulse Notifications - Email/Push ===
PULSE_NOTIFICATION_EMAIL_TOKEN=

# === Pulse Notifications - SMS ===
PULSE_NOTIFICATION_SMS_TOKEN=

# === Pulse Payment ===
PULSE_PAYMENT_API_KEY=
PULSE_PAYMENT_AUTH_TOKEN=
PULSE_PAYMENT_SERVICE_KEY=
```
