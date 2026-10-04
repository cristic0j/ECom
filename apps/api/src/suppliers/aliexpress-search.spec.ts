import {
  categoryTree,
  feedItems,
  feedTotalPages,
  filterHits,
  pickFeed,
  searchItems,
  searchParams,
  searchTotalPages,
  type DsSearchResponse,
} from "./aliexpress-search";

const response: DsSearchResponse = {
  code: "00",
  data: {
    totalCount: 38679,
    products: {
      selection_search_product: [
        {
          itemId: "1005010588781328",
          title: " Silicone Phone Holder ",
          itemMainPic: "//ae-pic-a1.aliexpress-media.com/kf/a.jpg",
          targetSalePrice: "1.11",
          targetOriginalPriceCurrency: "EUR",
          orders: "50,000+",
          score: "4.5",
          evaluateRate: "90.6",
        },
        { itemId: "1005000000000002", title: "No reviews", targetSalePrice: "2.00", score: "", orders: "" },
        { itemId: "1005000000000003", title: "Priced in dollars", targetSalePrice: "3.00", targetOriginalPriceCurrency: "USD" },
        { title: "No id" },
      ],
    },
  },
};

describe("searchParams", () => {
  it("asks for the store's country and currency, and leaves out what isn't set", () => {
    expect(searchParams({ q: "holder", sort: "orders", page: 2 }, "NL", "EUR")).toEqual({
      keyWord: "holder",
      local: "en_US",
      countryCode: "NL",
      currency: "EUR",
      pageSize: "20",
      pageIndex: "2",
      sortBy: "orders,desc",
    });
    expect(searchParams({ q: "holder", sort: "best", page: 1, categoryId: "34" }, "US", "EUR")).toMatchObject({ categoryId: "34" });
    expect(searchParams({ q: "holder", sort: "best", page: 1 }, "US", "EUR")).not.toHaveProperty("sortBy");
    expect(searchParams({ q: "holder", sort: "reviews", page: 1 }, "US", "EUR").sortBy).toBe("comments,desc");
    // A subcategory on its own: no keyWord at all
    expect(searchParams({ q: "", sort: "orders", page: 1, categoryId: "200001168" }, "NL", "EUR")).not.toHaveProperty("keyWord");
  });
});

describe("searchItems", () => {
  it("maps hits, marks the ones already in the store, and skips what it can't use", () => {
    const items = searchItems(response, "EUR", new Map([["1005000000000002", "prod_1"]]));
    expect(items).toEqual([
      {
        productId: "1005010588781328",
        title: "Silicone Phone Holder",
        image: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
        costMinor: 111,
        sold: "50,000+",
        rating: 4.5,
        positiveRate: 90.6,
        url: "https://www.aliexpress.com/item/1005010588781328.html",
        importedProductId: null,
      },
      expect.objectContaining({ productId: "1005000000000002", costMinor: 200, sold: null, rating: null, importedProductId: "prod_1" }),
      expect.objectContaining({ productId: "1005000000000003", costMinor: null }),
    ]);
  });

  it("keeps only the hits in the price range, and drops hits without a price once a range is set", () => {
    const items = searchItems(response, "EUR", new Map()); // costs: 111, 200, null
    const costs = (minCost?: number, maxCost?: number) => filterHits(items, { minCost, maxCost }).map((i) => i.costMinor);
    expect(costs()).toEqual([111, 200, null]);
    expect(costs(150)).toEqual([200]);
    expect(costs(undefined, 150)).toEqual([111]);
    expect(costs(111, 200)).toEqual([111, 200]);
  });

  it("filters by sales and reviews, using stars where there are some and the positive share otherwise", () => {
    const hit = (productId: string, sold: string | null, rating: number | null, positiveRate: number | null) => ({
      productId, title: productId, image: null, costMinor: 100, sold, rating, positiveRate, url: "", importedProductId: null,
    });
    const items = [
      hit("popular", "10,000+", 4.6, 90), // stars win over the positive share
      hit("some", "1,234", null, 96), // bestseller-list style: positive share only
      hit("few", "40", 4.1, null),
      hit("unknown", null, null, null),
    ];
    const ids = (f: Parameters<typeof filterHits>[1]) => filterHits(items, f).map((i) => i.productId);
    expect(ids({})).toEqual(["popular", "some", "few", "unknown"]);
    expect(ids({ minSold: 1000 })).toEqual(["popular", "some"]);
    expect(ids({ minSold: 10000 })).toEqual(["popular"]);
    expect(ids({ reviews: "good" })).toEqual(["popular", "some", "few"]);
    expect(ids({ reviews: "excellent" })).toEqual(["popular", "some"]);
    expect(ids({ minSold: 100, reviews: "excellent", maxCost: 100 })).toEqual(["popular", "some"]);
  });

  it("counts pages, up to AliExpress's 50", () => {
    expect(searchTotalPages(response)).toBe(50);
    expect(searchTotalPages({ data: { totalCount: 41 } })).toBe(3);
    expect(searchTotalPages({ data: { totalCount: 0 } })).toBeNull();
  });
});

describe("bestseller feed", () => {
  it("maps feed products like search hits, with sales as a number and the positive-review share", () => {
    const feed = {
      rsp_code: 200,
      result: {
        total_record_count: 11209,
        products: {
          traffic_product_d_t_o: [
            {
              product_id: 1005001369687870,
              product_title: "Dental Air Motor",
              product_main_image_url: "https://ae-pic-a1.aliexpress-media.com/kf/S6b.jpg",
              target_sale_price: "20.19",
              target_sale_price_currency: "EUR",
              lastest_volume: 6946,
              evaluate_rate: "98.0%",
            },
            { product_title: "No id" },
          ],
        },
      },
    };
    expect(feedItems(feed, "EUR", new Map([["1005001369687870", "prod_9"]]))).toEqual([
      {
        productId: "1005001369687870",
        title: "Dental Air Motor",
        image: "https://ae-pic-a1.aliexpress-media.com/kf/S6b.jpg",
        costMinor: 2019,
        sold: "6,946",
        rating: null,
        positiveRate: 98,
        url: "https://www.aliexpress.com/item/1005001369687870.html",
        importedProductId: "prod_9",
      },
    ]);
    expect(feedTotalPages(feed)).toBe(50);

    const unsorted = { result: { products: { traffic_product_d_t_o: [3, 900, 40].map((v, i) => ({ product_id: 100000 + i, lastest_volume: v })) } } };
    expect(feedItems(unsorted, "EUR", new Map()).map((i) => i.sold)).toEqual(["3", "900", "40"]);
    expect(feedItems(unsorted, "EUR", new Map(), { bySales: true }).map((i) => i.sold)).toEqual(["900", "40", "3"]);
    expect(feedTotalPages({ result: { total_record_count: 0 } })).toBeNull();
  });

  it("picks the biggest bestseller list, or else the biggest list", () => {
    const promos = (list: [string, number][]) => ({
      resp_result: { result: { promos: { promo: list.map(([promo_name, product_num]) => ({ promo_name, product_num })) } } },
    });
    expect(pickFeed(promos([["AEB_UK_SelectedItems", 200251], ["AEB_Droplo_BestsellersItems", 200069], ["Bestsellers_small", 10]]))).toBe(
      "AEB_Droplo_BestsellersItems",
    );
    expect(pickFeed(promos([["Small", 5], ["Big", 50]]))).toBe("Big");
    expect(pickFeed(promos([]))).toBeNull();
  });
});

describe("categoryTree", () => {
  it("nests subcategories under their parent, both sorted by name", () => {
    const tree = categoryTree({
      resp_result: {
        result: {
          categories: {
            category: [
              { category_id: 34, category_name: "Automobiles" },
              { category_id: 2, category_name: "Food" },
              { category_id: 9, category_name: "Snacks", parent_category_id: 2 },
              { category_id: 8, category_name: "Coffee", parent_category_id: 2 },
              { category_id: 7, category_name: "Orphan", parent_category_id: 999 },
            ],
          },
        },
      },
    });
    expect(tree).toEqual([
      { id: "34", name: "Automobiles", children: [] },
      { id: "2", name: "Food", children: [{ id: "8", name: "Coffee" }, { id: "9", name: "Snacks" }] },
    ]);
  });
});
