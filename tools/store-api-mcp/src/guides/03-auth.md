# Customer accounts and sign-in

Customers sign in with email and password. A session is a JWT you keep on the
device and send as `Authorization: Bearer <token>`.

## Register (three calls)

1. **Create the login.**
   `POST /auth/customer/emailpass/register` with body `{ "email", "password" }`.
   This returns `{ "token": "…" }`, a registration token that is not yet
   tied to a customer.

2. **Create the customer** with that registration token:
   `POST /store/customers`, header `Authorization: Bearer <registration token>`,
   body:

   ```json
   {
     "email": "ada@example.com",
     "first_name": "Ada",
     "last_name": "Obi",
     "phone": "+2348012345678",
     "password": "the same password"
   }
   ```

   **All five fields are required.** Stock Medusa needs only the email; Ceedmart
   also requires `first_name`, `last_name`, `phone` and `password`, otherwise
   you get `400 Invalid request: Field 'phone' is required; …`. Send the phone
   in international form (`+234…`).

   The password is used to create the customer's account with Pulse, the
   payment provider. If that step fails, the customer is still created but
   cannot pay online: `GET /store/payment-options` then returns
   `reason: "no_pulse_identity"`. See `payments`.

3. **Sign in** to get a session token for that customer:
   `POST /auth/customer/emailpass` with `{ "email", "password" }`, which returns
   `{ "token": "…" }`.

The registration token from step 1 cannot be used as a session; always sign in
after step 2.

## Sign in

`POST /auth/customer/emailpass` with `{ "email", "password" }` returns
`{ "token" }`. Wrong credentials return 401.

## Using the session

- Send `Authorization: Bearer <token>` together with the publishable key.
- `GET /store/customers/me` returns the signed-in customer.
- Update the profile with `POST /store/customers/me`. Manage addresses with
  `/store/customers/me/addresses`.
- Refresh a token before it expires: `POST /auth/token/refresh` with the
  current token as Bearer returns a new `{ "token" }`.
- Sign out by deleting the token on the device.

## Carts and accounts

A cart created before sign-in can be attached to the customer after sign-in by
calling `POST /store/carts/{id}/customer` with the session token. A cart created
while signed in is attached automatically. Orders placed while signed in show
in `GET /store/orders`.

## Password reset

`POST /auth/customer/emailpass/reset-password` with `{ "identifier": "<email>" }`
emails a reset link on production. The link opens the website's reset page;
there is no app deep link yet. The website then calls
`POST /auth/customer/emailpass/update` with the reset token in the
`Authorization: Bearer` header (not the body) and `{ "email", "password" }`.

Staging sends no email, so reset cannot be completed there.

Exact parameters: `list_endpoints` with `group: "auth"` or `group: "customer"`.
