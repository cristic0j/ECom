import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { hash } from "@node-rs/argon2";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";
import { PrismaService } from "../src/prisma/prisma.service";

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

describe("API (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminCookie: string[];
  let editorCookie: string[];

  const http = () => request(app.getHttpServer());

  const login = async (email: string) => {
    const res = await http().post("/api/auth/login").send({ email, password: "pass12345" }).expect(200);
    return res.get("Set-Cookie")!;
  };

  const productBody = (overrides: Record<string, unknown> = {}) => ({
    slug: "e2e-tee",
    title: "E2E Tee",
    status: "ACTIVE",
    variants: [
      { sku: "E2E-S", title: "S", priceMinor: 2000, options: { size: "S" } },
      { sku: "E2E-M", title: "M", priceMinor: 1500, options: { size: "M" } },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes("schema=e2e")) {
      throw new Error("Refusing to run e2e tests outside the e2e schema");
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.$executeRawUnsafe(
      `TRUNCATE "Product", "Category", "AdminUser", "StoreSetting" RESTART IDENTITY CASCADE`,
    );
    const passwordHash = await hash("pass12345");
    await prisma.adminUser.createMany({
      data: [
        { email: "admin@test.dev", passwordHash, role: "ADMIN" },
        { email: "editor@test.dev", passwordHash, role: "EDITOR" },
      ],
    });
    adminCookie = await login("admin@test.dev");
    editorCookie = await login("editor@test.dev");
  });

  afterAll(async () => {
    await app.close();
  });

  describe("auth", () => {
    it("rejects bad credentials with a uniform error", async () => {
      const res = await http().post("/api/auth/login").send({ email: "admin@test.dev", password: "nope" }).expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, message: "Invalid email or password" });
    });

    it("sets an httpOnly cookie and returns the user on /me", async () => {
      expect(adminCookie.join(";")).toMatch(/ecom_admin=.*HttpOnly/i);
      const res = await http().get("/api/auth/me").set("Cookie", adminCookie).expect(200);
      expect(res.body).toMatchObject({ email: "admin@test.dev", role: "ADMIN" });
      expect(res.body.passwordHash).toBeUndefined();
    });

    it("blocks admin routes without a session", async () => {
      await http().get("/api/admin/products").expect(401);
    });
  });

  describe("products + catalog", () => {
    let categoryId: string;
    let productId: string;

    it("creates a category tree", async () => {
      const parent = await http()
        .post("/api/admin/categories")
        .set("Cookie", adminCookie)
        .send({ slug: "clothing", name: "Clothing" })
        .expect(201);
      const child = await http()
        .post("/api/admin/categories")
        .set("Cookie", adminCookie)
        .send({ slug: "shirts", name: "Shirts", parentId: parent.body.id })
        .expect(201);
      categoryId = child.body.id;

      // Moving the parent under its own child must fail
      await http()
        .put(`/api/admin/categories/${parent.body.id}`)
        .set("Cookie", adminCookie)
        .send({ slug: "clothing", name: "Clothing", parentId: child.body.id })
        .expect(400);

      const tree = await http().get("/api/catalog/categories").expect(200);
      expect(tree.body[0]).toMatchObject({ slug: "clothing", children: [{ slug: "shirts" }] });
    });

    it("validates product input", async () => {
      const res = await http()
        .post("/api/admin/products")
        .set("Cookie", adminCookie)
        .send({ slug: "Bad Slug", title: "", variants: [] })
        .expect(400);
      expect(res.body.message).toBe("Validation failed");
    });

    it("creates a product with variants and a default", async () => {
      const res = await http()
        .post("/api/admin/products")
        .set("Cookie", editorCookie)
        .send(productBody({ categoryIds: [categoryId] }))
        .expect(201);
      productId = res.body.id;
      expect(res.body.variants).toHaveLength(2);
      expect(res.body.variants[0].isDefault).toBe(true);
    });

    it("returns 409 on duplicate slug", async () => {
      await http()
        .post("/api/admin/products")
        .set("Cookie", adminCookie)
        .send(productBody({ variants: [{ sku: "OTHER", priceMinor: 1 }] }))
        .expect(409);
    });

    it("lists active products with min price, filtered by parent category", async () => {
      const res = await http().get("/api/catalog/products?category=clothing").expect(200);
      expect(res.body).toMatchObject({ total: 1, page: 1 });
      expect(res.body.items[0]).toMatchObject({ slug: "e2e-tee", priceMinor: 1500 });
    });

    it("searches by title and SKU", async () => {
      expect((await http().get("/api/catalog/products?q=tee").expect(200)).body.total).toBe(1);
      expect((await http().get("/api/catalog/products?q=e2e-m").expect(200)).body.total).toBe(1);
      expect((await http().get("/api/catalog/products?q=zzz").expect(200)).body.total).toBe(0);
    });

    it("updates variants while keeping existing ids stable", async () => {
      const before = await http().get(`/api/admin/products/${productId}`).set("Cookie", adminCookie).expect(200);
      const [s, m] = before.body.variants;
      const res = await http()
        .put(`/api/admin/products/${productId}`)
        .set("Cookie", adminCookie)
        // swap SKUs between the two kept variants, drop none, add one
        .send(
          productBody({
            variants: [
              { ...s, sku: "E2E-M" },
              { ...m, sku: "E2E-S", priceMinor: 900 },
              { sku: "E2E-L", title: "L", priceMinor: 2500, options: { size: "L" } },
            ],
          }),
        )
        .expect(200);
      expect(res.body.variants.map((v: { id: string }) => v.id).slice(0, 2)).toEqual([s.id, m.id]);
      expect(res.body.variants.map((v: { sku: string }) => v.sku)).toEqual(["E2E-M", "E2E-S", "E2E-L"]);

      const list = await http().get("/api/catalog/products?sort=price_asc").expect(200);
      expect(list.body.items[0].priceMinor).toBe(900);
    });

    it("hides drafts from the public catalog but not from admin", async () => {
      await http()
        .patch(`/api/admin/products/${productId}/status`)
        .set("Cookie", adminCookie)
        .send({ status: "DRAFT" })
        .expect(200);
      await http().get("/api/catalog/products/e2e-tee").expect(404);
      expect((await http().get("/api/catalog/products").expect(200)).body.total).toBe(0);
      await http().get(`/api/admin/products/${productId}`).set("Cookie", adminCookie).expect(200);
    });

    it("only lets ADMIN delete", async () => {
      await http().delete(`/api/admin/products/${productId}`).set("Cookie", editorCookie).expect(403);
      await http().delete(`/api/admin/products/${productId}`).set("Cookie", adminCookie).expect(204);
      await http().get(`/api/admin/products/${productId}`).set("Cookie", adminCookie).expect(404);
    });
  });

  describe("media", () => {
    it("accepts a real PNG and serves it", async () => {
      const res = await http()
        .post("/api/admin/media")
        .set("Cookie", adminCookie)
        .attach("file", PNG, { filename: "x.png", contentType: "image/png" })
        .expect(201);
      const path = new URL(res.body.url).pathname;
      const file = await http().get(path).expect(200);
      expect(file.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("rejects a non-image disguised as PNG", async () => {
      await http()
        .post("/api/admin/media")
        .set("Cookie", adminCookie)
        .attach("file", Buffer.from("<script>alert(1)</script>"), { filename: "x.png", contentType: "image/png" })
        .expect(400);
    });
  });

  describe("settings", () => {
    it("lets ADMIN update settings and exposes them publicly", async () => {
      await http()
        .put("/api/admin/settings")
        .set("Cookie", editorCookie)
        .send({ name: "Nope" })
        .expect(403);
      await http()
        .put("/api/admin/settings")
        .set("Cookie", adminCookie)
        .send({ name: "Test Shop", theme: { accent: "10 80% 50%" } })
        .expect(200);
      const res = await http().get("/api/settings").expect(200);
      expect(res.body).toMatchObject({ name: "Test Shop", theme: { accent: "10 80% 50%" } });
    });

    it("rejects unknown keys", async () => {
      await http().put("/api/admin/settings").set("Cookie", adminCookie).send({ secretKey: "x" }).expect(400);
    });
  });
});
