# Quickstart: from nothing to a placed order on staging

You can run each step with `call_store_api`. Replace `<…>` with values from
earlier steps.

1. **Environment and location map:** `get_environment` gives the publishable
   key, the Nigeria `region_id`, and per city the `sales_channel_id` and
   `province`, plus `default_sales_channel_id`.

2. **Browse Lagos:**
   `GET /store/products` with query
   `region_id=<reg>`, `sales_channel_id=<lagos channel>`,
   `fields=*variants.calculated_price`, `limit=5`.
   Pick a variant with `available_here: true`.

3. **Register and sign in** (see `auth`):
   - `POST /auth/customer/emailpass/register` with `{ "email": "you+1@staging.ceedmart.test", "password": "Test12345!" }`, which returns a registration token
   - `POST /store/customers` with that token as `customer_token` and
     `{ "email", "first_name", "last_name", "phone": "+2340001234567", "password" }`
   - `POST /auth/customer/emailpass` with the same email and password, which returns the session token

4. **Cart:** `POST /store/carts` with
   `{ "region_id": "<reg>", "sales_channel_id": "<default channel>", "metadata": { "ceedmart": { "province": "ng-la" } } }`
   and the session token.

5. **Add the variant:** `POST /store/carts/<cart>/line-items` with `{ "variant_id": "<variant>", "quantity": 1 }`.
   The unit price is the Lagos price.

6. **Address:** `POST /store/carts/<cart>` with a Lagos `shipping_address` (see `cart-and-checkout`).

7. **Delivery or pickup:** `GET /store/shipping-options` with `cart_id=<cart>`,
   then `POST /store/carts/<cart>/shipping-methods` with `{ "option_id": "<option>" }`.
   Record the choice in `metadata.ceedmart`, sending the whole object.

8. **Pay (staging):** `POST /store/payment-collections` with `{ "cart_id": "<cart>" }`, then
   `POST /store/payment-collections/<collection>/payment-sessions` with `{ "provider_id": "pp_bank-transfer_manual" }`.
   Production uses Pulse Pay (see `payments`).

9. **Complete:** `POST /store/carts/<cart>/complete` returns `{ "type": "order", "order": … }`.

10. **See it:** `GET /store/orders` with the session token.

To see location rules in action, add Palm Oil's 4-litre variant in step 5:
staging marks it not available in Lagos, and the error message is what the
app should show.
