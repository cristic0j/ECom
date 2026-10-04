"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminProductDto } from "@ecom/shared";
import { adminApi } from "@/lib/admin-api";
import { Alert } from "@/components/ui/misc";
import { ProductEditor } from "@/components/admin/product-editor";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<AdminProductDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.getProduct(id).then(setProduct).catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <Alert>
        {error}. <Link href="/admin/products" className="underline">Back to products</Link>
      </Alert>
    );
  }
  if (!product) return <p className="text-muted-foreground">Loading…</p>;
  // key: remount the editor when navigating between products
  return <ProductEditor key={product.id} product={product} />;
}
