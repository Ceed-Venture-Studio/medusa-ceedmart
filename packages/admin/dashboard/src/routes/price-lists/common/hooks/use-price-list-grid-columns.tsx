import { HttpTypes } from "@medusajs/types"
import { ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { Thumbnail } from "../../../../components/common/thumbnail"
import {
  createDataGridHelper,
  DataGrid,
} from "../../../../components/data-grid"
import { DataGridCurrencyCell } from "../../../../components/data-grid/components/data-grid-currency-cell"
import { IncludesTaxTooltip } from "../../../../components/common/tax-badge/tax-badge"
import { getLocaleAmount } from "../../../../lib/money-amount-helpers"
import { PricingCreateSchemaType } from "../../price-list-create/components/price-list-create-form/schema"
import { getVariantCurrentPrice, isProductRow } from "../utils"

const columnHelper = createDataGridHelper<
  HttpTypes.AdminProduct | HttpTypes.AdminProductVariant,
  PricingCreateSchemaType
>()

export const usePriceListGridColumns = ({
  currencies = [],
  regions = [],
  pricePreferences = [],
}: {
  currencies?: HttpTypes.AdminStoreCurrency[]
  regions?: HttpTypes.AdminRegion[]
  pricePreferences?: HttpTypes.AdminPricePreference[]
}) => {
  const { t } = useTranslation()

  const currencyCode = (
    currencies.find((c) => c.is_default) ?? currencies[0]
  )?.currency_code

  const colDefs: ColumnDef<
    HttpTypes.AdminProduct | HttpTypes.AdminProductVariant
  >[] = useMemo(() => {
    return [
      columnHelper.column({
        id: t("fields.title"),
        header: t("fields.title"),
        cell: (context) => {
          const entity = context.row.original
          if (isProductRow(entity)) {
            return (
              <DataGrid.ReadonlyCell context={context}>
                <div className="flex h-full w-full items-center gap-x-2 overflow-hidden">
                  <Thumbnail src={entity.thumbnail} size="small" />
                  <span className="truncate">{entity.title}</span>
                </div>
              </DataGrid.ReadonlyCell>
            )
          }

          return (
            <DataGrid.ReadonlyCell context={context} color="normal">
              <div className="flex h-full w-full items-center gap-x-2 overflow-hidden">
                <span className="truncate">{entity.title}</span>
              </div>
            </DataGrid.ReadonlyCell>
          )
        },
        disableHiding: true,
      }),
      // Ceedmart: a price list is edited as two columns rather than one per
      // currency and region. "Current price" shows what the variant sells
      // for today; "Discounted price" is the price list's price in the
      // store's default currency, which applies wherever that currency is
      // sold (web and POS alike). Leave it empty and the variant keeps its
      // current price.
      ...(currencyCode
        ? [
            columnHelper.column({
              id: "current_price",
              name: "Current price",
              header: `Current price (${currencyCode.toUpperCase()})`,
              cell: (context) => {
                const entity = context.row.original
                if (isProductRow(entity)) {
                  return <DataGrid.ReadonlyCell context={context} />
                }

                const amount = getVariantCurrentPrice(entity, currencyCode)

                return (
                  <DataGrid.ReadonlyCell context={context}>
                    {amount != null ? getLocaleAmount(amount, currencyCode) : "-"}
                  </DataGrid.ReadonlyCell>
                )
              },
              disableHiding: true,
            }),
            columnHelper.column({
              id: `currency_prices.${currencyCode}`,
              name: "Discounted price",
              header: () => (
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="truncate">
                    {`Discounted price (${currencyCode.toUpperCase()})`}
                  </span>
                  <IncludesTaxTooltip
                    includesTax={
                      pricePreferences.find(
                        (p) =>
                          p.attribute === "currency_code" &&
                          p.value === currencyCode
                      )?.is_tax_inclusive
                    }
                  />
                </div>
              ),
              field: (context) => {
                const entity = context.row.original
                if (isProductRow(entity)) {
                  return null
                }

                return `products.${entity.product_id}.variants.${entity.id}.currency_prices.${currencyCode}.amount`
              },
              type: "number",
              cell: (context) => {
                if (isProductRow(context.row.original)) {
                  return <DataGrid.ReadonlyCell context={context} />
                }

                return (
                  <DataGridCurrencyCell code={currencyCode} context={context} />
                )
              },
              disableHiding: true,
            }),
          ]
        : []),
    ]
  }, [t, currencyCode, pricePreferences])

  return colDefs
}
