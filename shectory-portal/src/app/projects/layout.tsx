import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { adminSessionOk } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  // Never cache protected project pages.
  noStore();
  if (!adminSessionOk()) redirect("/login");
  return children;
}

