import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist or is no longer available.</p>
      <Link href="/" className={`${buttonClass()} mt-6`}>
        Back to the shop
      </Link>
    </div>
  );
}
