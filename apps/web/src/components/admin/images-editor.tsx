"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Trash2, Upload } from "lucide-react";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@ecom/shared";
import { adminApi } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";

export type ImageRow = { url: string; alt: string };

export function ImagesEditor({ images, onChange }: { images: ImageRow[]; onChange: (images: ImageRow[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    const added: ImageRow[] = [];
    try {
      for (const file of Array.from(files)) {
        if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) throw new Error(`${file.name}: unsupported type`);
        if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name}: larger than 5 MB`);
        const { url } = await adminApi.uploadImage(file);
        added.push({ url, alt: "" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      if (added.length) onChange([...images, ...added]);
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const next = [...images];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {images.map((img, i) => (
            <li key={img.url + i} className="space-y-2">
              <div className="relative aspect-square overflow-hidden rounded-(--radius) bg-muted">
                <Image src={img.url} alt={img.alt} fill sizes="200px" className="object-cover" />
                {i === 0 && (
                  <span className="absolute top-2 left-2 rounded bg-background/90 px-2 py-0.5 text-xs">Main</span>
                )}
              </div>
              <Input
                aria-label={`Alt text for image ${i + 1}`}
                placeholder="Alt text"
                value={img.alt}
                onChange={(e) => onChange(images.map((im, j) => (j === i ? { ...im, alt: e.target.value } : im)))}
              />
              <div className="flex justify-between">
                <div className="flex">
                  <Button size="sm" variant="ghost" aria-label="Move left" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowLeft className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move right"
                    disabled={i === images.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove image ${i + 1}`}
                  onClick={() => onChange(images.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        multiple
        className="sr-only"
        id="image-upload"
        data-testid="image-upload"
        onChange={(e) => upload(e.target.files)}
      />
      <Button variant="secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>
        <Upload className="size-4" /> {uploading ? "Uploading…" : "Upload images"}
      </Button>
    </div>
  );
}
