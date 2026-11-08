# Catalog, locations and location pricing

## 1. Load the location map once

`GET /store/web-locations`

```json
{
  "default_sales_channel_id": "sc_…",
  "locations": [
    { "id": "port-harcourt", "sales_channel_id": "sc_…", "province": "ng-ri" },
    { "id": "uyo",           "sales_channel_id": "sc_…", "province": "ng-ak" },
    { "id": "lagos",         "sales_channel_id": "sc_…", "province": "ng-la" }
  ]
}
```

- `id` is the city the shopper picks. Show the city name, not the state.
- `sales_channel_id` is that city's catalog. Ids differ between staging and
  production, so always read them from this endpoint; never hard-code them.
- `province` is the state (ISO 3166-2, lower case). Prices and availability
  are set per state; you stamp it on the cart.
- `default_sales_channel_id` is for carts, and for listings before a city is
  chosen.

Ask for the city on first launch and remember it.

## 2. List products for the chosen city

`GET /store/products?region_id=<reg>&sales_channel_id=<city channel>&fields=*variants.calculated_price,+variants.inventory_quantity`

- **Always pass the city's `sales_channel_id`.** The key covers several
  channels, and a product query that asks for stock must name exactly one.
  Before a city is chosen, use `default_sales_channel_id`.
- A product not linked to a city's channel is not listed there at all. That
  is how a product is hidden from a city.
- `region_id`: the Nigeria region from `GET /store/regions`.
- Ask only for the fields you show. `*variants.calculated_price` is needed for
  prices.

## 3. Location pricing and availability

When the request names a city (`sales_channel_id` of a city channel, or
`province=ng-la`), the response is priced for that state and annotated:

```json
{
  "product": {
    "id": "prod_…",
    "location": { "province": "ng-la", "name": "Lagos" },
    "available_here": true,
    "variants": [
      {
        "id": "variant_…",
        "calculated_price": { "calculated_amount": 60000, "original_amount": 60000, … },
        "available_here": true
      },
      {
        "id": "variant_…",
        "calculated_price": { "calculated_amount": 8910, … },
        "available_here": false
      }
    ]
  }
}
```

- `calculated_price.calculated_amount` is the price to show. It already
  includes the state's price and any sale, so never compute prices on the
  device.
- If `calculated_price.calculated_price.price_list_type` is `"sale"` and
  `original_amount` is higher, show the original amount struck through.
- `variants[].available_here: false` means the item is listed in this city
  but cannot be bought here. Show "Not available in Lagos" and disable add to
  cart. The backend refuses it anyway.
- `product.available_here: false` means no variant can be bought here.
- With no city (default channel) there is no `location` and no
  `available_here`; national prices apply.

The same product can cost different amounts in different cities. Re-fetch
listings when the shopper changes city; never reuse cached prices across
cities.

## Other catalog reads

- Categories: `GET /store/product-categories`. Collections: `GET /store/collections`.
- Search: `GET /store/products?q=rice`.
- One product: `GET /store/products/{id}` with the same `region_id` and
  `sales_channel_id`.
- Banners for the home screen: `GET /store/banners`.
- Feature flags: `GET /store/feature-flags`. These say which features
  (pre-order, custom builds, auctions) are switched on; hide what is off.
- Commerce type per product (standard, pre-order, custom build, auction):
  `GET /store/listing-policies`. Auction and custom-build items cannot go
  through the normal cart.

Use `list_endpoints` with `group: "catalog"` and `get_endpoint` for exact
parameters.
