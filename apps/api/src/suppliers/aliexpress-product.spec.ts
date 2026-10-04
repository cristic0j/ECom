import { buildImport, htmlToText, ImportError, parseProductId, suggestedPrice, type DsProductResponse, type DsSku } from "./aliexpress-product";

const sku = (id: string, price: string, color: [number, string, string], stock = 10, shipsFrom?: string): DsSku => ({
  sku_id: id,
  offer_sale_price: price,
  currency_code: "EUR",
  sku_available_stock: stock,
  ae_sku_property_dtos: {
    ae_sku_property_d_t_o: [
      {
        sku_property_name: "Color",
        property_value_id: color[0],
        sku_property_value: color[1],
        property_value_definition_name: color[2],
        sku_image: `https://ae01.alicdn.com/kf/${color[1]}.jpg`,
      },
      ...(shipsFrom ? [{ sku_property_name: "Ships From", property_value_id: shipsFrom, sku_property_value: shipsFrom }] : []),
    ],
  },
});

const product = (skus: DsSku[], deliveryDays = 7): DsProductResponse => ({
  rsp_code: 200,
  result: {
    ae_item_base_info_dto: {
      subject: "Bone Conduction Earphones",
      detail: '<div><p style="x">Feature:</p><p>Long battery &amp; clear sound</p><img src="a.jpg"></div>',
    },
    ae_multimedia_info_dto: { image_urls: "https://ae01.alicdn.com/kf/1.jpg;https://ae01.alicdn.com/kf/2.jpg;https://ae01.alicdn.com/kf/1.jpg" },
    ae_item_sku_info_dtos: { ae_item_sku_info_d_t_o: skus },
    ae_item_properties: {
      ae_item_property: [
        { attr_name: "Brand Name", attr_value: "STTK" },
        { attr_name: "Feature", attr_value: "Waterproof" },
        { attr_name: "Feature", attr_value: "Mic" },
      ],
    },
    logistics_info_dto: { delivery_time: deliveryDays },
  },
});

describe("parseProductId", () => {
  it.each([
    ["https://www.aliexpress.com/item/1005008358373725.html?spm=a2g0o&skuId=1", "1005008358373725"],
    ["aliexpress.com/item/1005008358373725.html", "1005008358373725"],
    ["https://m.aliexpress.com/item/1005008358373725.html", "1005008358373725"],
    ["https://www.aliexpress.us/item/3256807000000000.html", "3256807000000000"],
    ["https://de.aliexpress.com/item/1005008358373725.html", "1005008358373725"],
    ["https://www.aliexpress.com/i/1005008358373725.html?productId=1005008358373725", "1005008358373725"],
    ["  1005008358373725 ", "1005008358373725"],
  ])("reads %s", (input, id) => expect(parseProductId(input)).toBe(id));

  it.each([
    "https://evil.example/item/1005008358373725.html",
    "https://aliexpress.com.evil.example/item/1005008358373725.html",
    "https://a.aliexpress.com/_mKZ1abc",
    "earbuds",
  ])("rejects %s", (input) => expect(parseProductId(input)).toBeNull());
});

describe("htmlToText", () => {
  it("keeps the text, one paragraph per line, with entities decoded", () => {
    expect(htmlToText('<p>Feature:</p><p>A &amp; B&nbsp;&#8211; C</p><script>x()</script><br>End')).toBe("Feature:\nA & B – C\n\nEnd");
  });
});

describe("suggestedPrice", () => {
  it("is cost × 2.5 rounded up to .99", () => {
    expect(suggestedPrice(469)).toBe(1199);
    expect(suggestedPrice(400)).toBe(999);
    expect(suggestedPrice(10)).toBe(99);
  });
});

describe("buildImport", () => {
  const nl = product([
    sku("1", "4.69", [1052, "Pink", "Pink"], 117),
    sku("2", "4.69", [2031, "ORANGE RED", "Black"], 94),
    sku("3", "4.69", [193, "black", "Black"], 0),
  ]);
  const us = product(
    [sku("1", "3.22", [1052, "Pink", "Pink"]), sku("2", "5.10", [2031, "ORANGE RED", "Black"]), sku("3", "3.25", [193, "black", "Black"])],
    12,
  );

  it("makes one option per sku, numbering repeated names, with the highest cost over the countries", () => {
    const draft = buildImport("100", [
      { country: "NL", response: nl },
      { country: "US", response: us },
      { country: "DE", response: null },
    ], "EUR");

    expect(draft.title).toBe("Bone Conduction Earphones");
    expect(draft.variants.map((v) => [v.title, v.options, v.costMinor, v.inStock, v.isDefault, v.sku])).toEqual([
      ["Pink", { Color: "Pink" }, 469, true, true, "AE-1"],
      ["Black", { Color: "Black" }, 510, true, false, "AE-2"],
      ["Black (2)", { Color: "Black (2)" }, 469, false, false, "AE-3"],
    ]);
    expect(draft.variants[0]).toMatchObject({ supplierSkuId: "1", priceMinor: 1199, image: "https://ae01.alicdn.com/kf/Pink.jpg" });
    expect(draft.countries).toEqual([
      { country: "NL", available: true, costMinor: 469, deliveryDays: 7 },
      { country: "US", available: true, costMinor: 322, deliveryDays: 12 },
      { country: "DE", available: false, costMinor: null, deliveryDays: null },
    ]);
    expect(draft.images).toEqual(["https://ae01.alicdn.com/kf/1.jpg", "https://ae01.alicdn.com/kf/2.jpg"]);
    expect(draft.attributes).toEqual({ "Brand Name": "STTK", Feature: "Waterproof, Mic" });
    expect(draft.description).toBe("Feature:\nLong battery & clear sound");
  });

  it("drops Ships From and keeps the in-stock, cheapest warehouse", () => {
    const draft = buildImport("100", [
      {
        country: "NL",
        response: product([
          sku("cn", "4.00", [1052, "Pink", "Pink"], 50, "China"),
          sku("es", "6.00", [1052, "Pink", "Pink"], 50, "Spain"),
          sku("cn-black", "3.00", [193, "black", "Black"], 0, "China"),
          sku("es-black", "5.00", [193, "black", "Black"], 20, "Spain"),
        ]),
      },
    ], "EUR");
    expect(draft.variants.map((v) => [v.title, v.supplierSkuId])).toEqual([
      ["Pink", "cn"],
      ["Black", "es-black"],
    ]);
  });

  it("uses the first country that sells it as the base, and makes a single option Default", () => {
    const single = product([{ sku_id: "9", offer_sale_price: "2.00", currency_code: "EUR", sku_available_stock: 3 }]);
    const draft = buildImport("100", [{ country: "NL", response: null }, { country: "US", response: single }], "EUR");
    expect(draft.variants).toEqual([expect.objectContaining({ title: "Default", options: {}, isDefault: true, costMinor: 200 })]);
  });

  it("explains when nothing can be imported", () => {
    expect(() => buildImport("100", [{ country: "NL", response: null }], "EUR")).toThrow(ImportError);
    const dollars = product([{ ...sku("1", "4.69", [1, "Red", "Red"]), currency_code: "USD" }]);
    expect(() => buildImport("100", [{ country: "NL", response: dollars }], "EUR")).toThrow(/USD/);
  });
});
