import { PrismaClient, ProductStatus, AdminRole } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

const img = (seed: string) => `https://picsum.photos/seed/${seed}/800/800`;

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.ADMIN_PASSWORD ?? "admin12345";

  await prisma.adminUser.upsert({
    where: { email },
    update: {},
    create: { email, name: "Admin", role: AdminRole.ADMIN, passwordHash: await hash(password) },
  });

  const apparel = await prisma.category.upsert({
    where: { slug: "apparel" },
    update: {},
    create: { slug: "apparel", name: "Apparel", sortOrder: 0 },
  });
  const tshirts = await prisma.category.upsert({
    where: { slug: "t-shirts" },
    update: {},
    create: { slug: "t-shirts", name: "T-Shirts", parentId: apparel.id, sortOrder: 0 },
  });
  const home = await prisma.category.upsert({
    where: { slug: "home" },
    update: {},
    create: { slug: "home", name: "Home", sortOrder: 1 },
  });

  const products = [
    {
      slug: "classic-tee",
      title: "Classic Tee",
      description: "A soft, everyday cotton t-shirt.",
      attributes: { material: "100% cotton" },
      categoryIds: [apparel.id, tshirts.id],
      variants: ["S", "M", "L"].flatMap((size, i) =>
        ["Black", "White"].map((color, j) => ({
          sku: `TEE-${color[0]}-${size}`,
          title: `${size} / ${color}`,
          priceMinor: 1999,
          options: { size, color },
          isDefault: i === 0 && j === 0,
          position: i * 2 + j,
        })),
      ),
      images: [img("tee1"), img("tee2")],
    },
    {
      slug: "ceramic-mug",
      title: "Ceramic Mug",
      description: "350ml stoneware mug, dishwasher safe.",
      attributes: { capacity: "350ml" },
      categoryIds: [home.id],
      variants: [{ sku: "MUG-001", title: "Default", priceMinor: 1200, compareAtMinor: 1500, options: {}, isDefault: true, position: 0 }],
      images: [img("mug1")],
    },
    {
      slug: "linen-throw",
      title: "Linen Throw",
      description: "Lightweight linen throw blanket.",
      attributes: { material: "linen" },
      categoryIds: [home.id],
      variants: [{ sku: "THROW-001", title: "Default", priceMinor: 4900, options: {}, isDefault: true, position: 0 }],
      images: [img("throw1")],
    },
  ];

  for (const p of products) {
    const existing = await prisma.product.findUnique({ where: { slug: p.slug } });
    if (existing) continue;
    await prisma.product.create({
      data: {
        slug: p.slug,
        title: p.title,
        description: p.description,
        status: ProductStatus.ACTIVE,
        attributes: p.attributes,
        categories: { create: p.categoryIds.map((categoryId) => ({ categoryId })) },
        variants: { create: p.variants },
        images: { create: p.images.map((url, position) => ({ url, alt: p.title, position })) },
      },
    });
  }

  console.log(`Seeded. Admin login: ${email} / ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
