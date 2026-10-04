import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { hash } from "@node-rs/argon2";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";
import { PrismaService } from "../src/prisma/prisma.service";
import { ALIEXPRESS_CLIENT } from "../src/suppliers/aliexpress-client";
import { PAYMENT_PROVIDER } from "../src/payments/payment-provider";
import type { DsProductResponse } from "../src/suppliers/aliexpress-product";
import { FakeAliExpress } from "./fake-aliexpress";

const IMG = "https://ae01.alicdn.com/kf";

const answer = (prices: [string, string, number][], deliveryDays: number): DsProductResponse => ({
  rsp_code: 200,
  result: {
    ae_item_base_info_dto: { subject: "Bone Conduction Earphones", detail: "<p>Long battery</p><p>Clear sound</p>" },
    ae_multimedia_info_dto: {
      image_urls: [`${IMG}/main.jpg`, `${IMG}/broken.jpg`, `${IMG}/not-an-image.jpg`, "https://evil.example/x.jpg"].join(";"),
    },
    ae_item_sku_info_dtos: {
      ae_item_sku_info_d_t_o: prices.map(([skuId, price, stock]) => ({
        sku_id: skuId,
        offer_sale_price: price,
        currency_code: "EUR",
        sku_available_stock: stock,
        ae_sku_property_dtos: {
          ae_sku_property_d_t_o: [
            {
              sku_property_name: "Color",
              property_value_id: skuId,
              sku_property_value: skuId === "s1" ? "Pink" : "Black",
              sku_image: `${IMG}/${skuId}.jpg`,
            },
          ],
        },
      })),
    },
    ae_item_properties: { ae_item_property: [{ attr_name: "Brand Name", attr_value: "STTK" }] },
    logistics_info_dto: { delivery_time: deliveryDays },
  },
});

describe("AliExpress import (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminCookie: string[];
  let editorCookie: string[];
  const fake = new FakeAliExpress();
  let imported: { id: string; slug: string; variants: { id: string; sku: string; title: string; supplierSkuId: string }[] };

  const http = () => request(app.getHttpServer());
  const login = async (email: string) =>
    (await http().post("/api/auth/login").send({ email, password: "pass12345" }).expect(200)).get("Set-Cookie")!;
  const importLink = (url: string) => http().post("/api/admin/aliexpress/import").set("Cookie", adminCookie).send({ url });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes("schema=e2e")) {
      throw new Error("Refusing to run e2e tests outside the e2e schema");
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ALIEXPRESS_CLIENT)
      .useValue(fake)
      // Manual payment, so checkouts here don't open payment pages
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(null)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.$executeRawUnsafe(`TRUNCATE "Product", "AdminUser", "StoreSetting", "SupplierConnection" RESTART IDENTITY CASCADE`);
    const passwordHash = await hash("pass12345");
    await prisma.adminUser.createMany({
      data: [
        { email: "admin@test.dev", passwordHash, role: "ADMIN" },
        { email: "editor@test.dev", passwordHash, role: "EDITOR" },
      ],
    });
    adminCookie = await login("admin@test.dev");
    editorCookie = await login("editor@test.dev");

    fake.products["1005001"] = {
      NL: answer([["s1", "4.69", 117], ["s2", "4.69", 0]], 7),
      US: answer([["s1", "3.22", 50], ["s2", "5.10", 40]], 12),
      DE: { rsp_code: 482, rsp_msg: "SHIP_TO_COUNTRY_PROHIBITED" },
    };
    const prohibited = { rsp_code: 482, rsp_msg: "SHIP_TO_COUNTRY_PROHIBITED" };
    fake.products["1005002"] = { NL: prohibited, US: prohibited, DE: prohibited };
  });

  afterAll(async () => {
    await app.close();
  });

  it("checks imports for the countries the store delivers to", async () => {
    const store = await http().get("/api/settings").expect(200);
    expect(store.body.shipping?.countries).toBeUndefined(); // store.config.ts default until changed

    await http().put("/api/admin/settings").set("Cookie", adminCookie).send({ shipping: { countries: [] } }).expect(400);
    await http().put("/api/admin/settings").set("Cookie", adminCookie).send({ shipping: { countries: ["Netherlands"] } }).expect(400);
    const saved = await http()
      .put("/api/admin/settings")
      .set("Cookie", adminCookie)
      .send({ shipping: { countries: ["nl", "US", "de", "NL"] } })
      .expect(200);
    expect(saved.body.shipping).toMatchObject({ countries: ["NL", "US", "DE"] });
  });

  it("needs a connected account", async () => {
    const res = await importLink("https://www.aliexpress.com/item/1005001.html").expect(503);
    expect(res.body.message).toMatch(/connect/i);
  });

  it("imports a product link as a draft with costs, photos and the per-country table", async () => {
    const auth = await http().post("/api/admin/aliexpress/authorize").set("Cookie", adminCookie).expect(200);
    const state = new URL(auth.body.url).searchParams.get("state")!;
    await http()
      .post("/api/admin/aliexpress/connect")
      .set("Cookie", adminCookie)
      .send({ code: `https://example.com/cb?${new URLSearchParams({ code: "good-1", state })}` })
      .expect(200);

    const res = await importLink("https://de.aliexpress.com/item/1005001.html?spm=abc").expect(201);
    imported = res.body;
    expect(res.body).toMatchObject({
      title: "Bone Conduction Earphones",
      slug: "bone-conduction-earphones",
      status: "DRAFT",
      notDeliveredTo: ["DE"],
      description: "Long battery\nClear sound",
      attributes: { "Brand Name": "STTK" },
      supplier: {
        supplier: "aliexpress",
        productId: "1005001",
        url: "https://www.aliexpress.com/item/1005001.html",
        countries: [
          { country: "NL", available: true, costMinor: 469, deliveryDays: 7 },
          { country: "US", available: true, costMinor: 322, deliveryDays: 12 },
          { country: "DE", available: false, costMinor: null, deliveryDays: null },
        ],
      },
    });
    expect(res.body.variants).toEqual([
      expect.objectContaining({ title: "Pink", sku: "AE-s1", supplierSkuId: "s1", costMinor: 469, priceMinor: 1199, inStock: true, isDefault: true }),
      expect.objectContaining({ title: "Black", sku: "AE-s2", supplierSkuId: "s2", costMinor: 510, priceMinor: 1299, inStock: false }),
    ]);
    expect(fake.calls.map((c) => [c.params.ship_to_country, c.params.target_currency, c.session])).toEqual([
      ["NL", "EUR", "at-good-1"],
      ["US", "EUR", "at-good-1"],
      ["DE", "EUR", "at-good-1"],
    ]);

    // Only AliExpress image hosts are fetched; a broken download or a non-image is skipped
    expect(fake.imageFetches).not.toContain("https://evil.example/x.jpg");
    expect(res.body.images).toHaveLength(3);
    expect(res.body.images.every((i: { url: string }) => /\/uploads\/products\/.+\.png$/.test(i.url))).toBe(true);
    const pink = res.body.variants.find((v: { title: string }) => v.title === "Pink");
    expect(res.body.images.map((i: { variantId: string | null }) => i.variantId)).toEqual([null, pink.id, expect.any(String)]);
  });

  it("refuses the same product twice, and explains links it can't use", async () => {
    const twice = await importLink("1005001").expect(409);
    expect(twice.body.message).toMatch(/already in your store as "Bone Conduction Earphones"/);

    await importLink("https://evil.example/item/1005001.html").expect(400);
    const missing = await importLink("https://www.aliexpress.com/item/1005999.html").expect(400);
    expect(missing.body.message).toMatch(/couldn't find this product/);
    const nowhere = await importLink("https://www.aliexpress.com/item/1005002.html").expect(400);
    expect(nowhere.body.message).toMatch(/won't sell this product to any of your countries \(SHIP_TO_COUNTRY_PROHIBITED\)/);
  });

  it("keeps the AliExpress link when the owner renames, reprices and edits costs", async () => {
    const [pink, black] = imported.variants;
    const res = await http()
      .put(`/api/admin/products/${imported.id}`)
      .set("Cookie", adminCookie)
      .send({
        slug: "bone-earphones",
        title: "Bone Earphones",
        status: "ACTIVE",
        // The owner blocks the US; Germany stays blocked because AliExpress doesn't ship there
        notDeliveredTo: ["US"],
        variants: [
          { id: pink.id, sku: pink.sku, title: "Rose", options: { Color: "Rose" }, priceMinor: 1495, costMinor: 480, isDefault: true },
          { id: black.id, sku: black.sku, title: "Graphite", options: { Color: "Graphite" }, priceMinor: 1495 },
          { sku: "MY-OWN", title: "White", options: { Color: "White" }, priceMinor: 1495 },
        ],
      })
      .expect(200);
    expect(res.body.variants.map((v: { title: string; supplierSkuId: string | null; costMinor: number | null }) => [v.title, v.supplierSkuId, v.costMinor])).toEqual([
      ["Rose", "s1", 480],
      ["Graphite", "s2", 510],
      ["White", null, null],
    ]);
    expect(res.body.supplier.productId).toBe("1005001");
    expect(res.body.notDeliveredTo).toEqual(["US", "DE"]);
  });

  it("never shows costs or the supplier on the storefront", async () => {
    const res = await http().get("/api/catalog/products/bone-earphones").expect(200);
    expect(res.body.title).toBe("Bone Earphones");
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/costMinor|supplier|aliexpress|1005001/i);
  });

  it("checkout only delivers to the store's countries, and blocks products that can't go there", async () => {
    const product = await http().get("/api/catalog/products/bone-earphones").expect(200);
    expect(product.body.notDeliveredTo).toEqual(["US", "DE"]);

    const guest = request.agent(app.getHttpServer());
    const cart = await guest.post("/api/cart/items").send({ variantId: product.body.variants[0].id }).expect(201);
    expect(cart.body.items[0].notDeliveredTo).toEqual(["US", "DE"]);

    const address = (country: string) => ({ name: "Ada Buyer", line1: "1 Main St", city: "Town", postalCode: "1234", country });
    const japan = await guest.post("/api/checkout").send({ email: "a@b.dev", shippingAddress: address("JP") }).expect(400);
    expect(japan.body.message).toBe("Sorry, we don't deliver to Japan");
    const germany = await guest.post("/api/checkout").send({ email: "a@b.dev", shippingAddress: address("DE") }).expect(409);
    expect(germany.body.message).toBe("Bone Earphones can't be delivered to Germany. Remove it from your cart to continue.");
    await guest.post("/api/checkout").send({ email: "a@b.dev", shippingAddress: address("nl") }).expect(201);
  });

  it("re-checks a product: new country table, costs and stock; the owner's names, prices and own blocks stay", async () => {
    fake.products["1005001"] = {
      NL: answer([["s1", "4.99", 0]], 8),
      US: answer([["s1", "3.50", 5]], 12),
      DE: answer([["s1", "4.79", 3]], 9),
    };
    const res = await http().post(`/api/admin/aliexpress/products/${imported.id}/recheck`).set("Cookie", adminCookie).expect(200);
    expect(res.body.notDeliveredTo).toEqual(["US"]); // Germany unlocked, the owner's US block kept
    expect(res.body.supplier.countries).toEqual([
      { country: "NL", available: true, costMinor: 499, deliveryDays: 8 },
      { country: "US", available: true, costMinor: 350, deliveryDays: 12 },
      { country: "DE", available: true, costMinor: 479, deliveryDays: 9 },
    ]);
    expect(res.body.variants.map((v: { title: string; costMinor: number | null; inStock: boolean; priceMinor: number }) => [v.title, v.costMinor, v.inStock, v.priceMinor])).toEqual([
      ["Rose", 499, false, 1495], // in stock where it's first sold (NL): no
      ["Graphite", 510, false, 1495], // no longer listed on AliExpress
      ["White", null, true, 1495], // added by hand: untouched
    ]);

    const handMade = await prisma.product.create({ data: { slug: "hand-made", title: "Hand made", variants: { create: { sku: "HM-1", priceMinor: 100 } } } });
    await http().post(`/api/admin/aliexpress/products/${handMade.id}/recheck`).set("Cookie", adminCookie).expect(400);
  });

  it("is admin-only", async () => {
    await http().post("/api/admin/aliexpress/import").set("Cookie", editorCookie).send({ url: "1005001" }).expect(403);
  });
});
