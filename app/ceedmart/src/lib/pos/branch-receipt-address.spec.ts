import {
  keepStoredAddress,
  resolveBranchReceiptAddress,
  withBranchAddress,
} from "./branch-receipt-address"

const scopeWith = (users: any[], channels: any[]) =>
  ({
    resolve: () => ({
      graph: async ({ entity }: { entity: string }) => ({
        data: entity === "user" ? users : channels,
      }),
    }),
  }) as any

const uyo = {
  id: "sc_uyo",
  metadata: {
    ceedmart: {
      code: "UYO",
      address: "12 Aka Road",
      city: "Uyo",
      state: "Akwa Ibom",
      phone: "0800 000 0001",
    },
  },
}

describe("resolveBranchReceiptAddress", () => {
  it("returns the shop's address for a user tied to it", async () => {
    const scope = scopeWith(
      [{ id: "u1", metadata: { ceedmart: { shop_id: "sc_uyo" } } }],
      [uyo]
    )
    expect(await resolveBranchReceiptAddress(scope, "u1")).toEqual({
      store_address: "12 Aka Road",
      store_address_2: "Uyo, Akwa Ibom",
      store_phone: "0800 000 0001",
    })
  })

  it("returns null for a user with no shop", async () => {
    const scope = scopeWith([{ id: "u1", metadata: null }], [uyo])
    expect(await resolveBranchReceiptAddress(scope, "u1")).toBeNull()
  })

  it("returns null when the sales channel is not a shop", async () => {
    const scope = scopeWith(
      [{ id: "u1", metadata: { ceedmart: { shop_id: "sc_web" } } }],
      [{ id: "sc_web", metadata: null }]
    )
    expect(await resolveBranchReceiptAddress(scope, "u1")).toBeNull()
  })

  it("returns null when the shop has neither address nor phone", async () => {
    const scope = scopeWith(
      [{ id: "u1", metadata: { ceedmart: { shop_id: "sc_uyo" } } }],
      [{ id: "sc_uyo", metadata: { ceedmart: { code: "UYO" } } }]
    )
    expect(await resolveBranchReceiptAddress(scope, "u1")).toBeNull()
  })
})

describe("withBranchAddress", () => {
  const stored = {
    other: 1,
    pos: {
      brand_name: "Ceedmart",
      store_address: "PH street",
      store_address_2: "Port Harcourt",
      store_phone: "0800 PH",
    },
  }

  it("replaces address, line 2 and phone, keeping everything else", () => {
    expect(
      withBranchAddress(stored, {
        store_address: "12 Aka Road",
        store_address_2: undefined,
        store_phone: "0800 UYO",
      })
    ).toEqual({
      other: 1,
      pos: {
        brand_name: "Ceedmart",
        store_address: "12 Aka Road",
        store_address_2: undefined,
        store_phone: "0800 UYO",
      },
    })
  })

  it("keeps the store-wide phone when the shop has none", () => {
    const out = withBranchAddress(stored, { store_address: "12 Aka Road" })
    expect((out.pos as any).store_phone).toBe("0800 PH")
  })

  it("does not modify its input", () => {
    withBranchAddress(stored, { store_address: "x" })
    expect(stored.pos.store_address).toBe("PH street")
  })
})

describe("keepStoredAddress", () => {
  it("puts back the stored address and keeps the other edits", () => {
    const incoming = {
      pos: {
        brand_name: "New brand",
        store_address: "12 Aka Road",
        store_address_2: "Uyo, Akwa Ibom",
        store_phone: "0800 UYO",
      },
    }
    const stored = {
      pos: { store_address: "PH street", store_phone: "0800 PH" },
    }
    expect(keepStoredAddress(incoming, stored)).toEqual({
      pos: {
        brand_name: "New brand",
        store_address: "PH street",
        store_phone: "0800 PH",
      },
    })
  })
})
