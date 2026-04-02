import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { adminSessionOk } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  noStore();
  if (!adminSessionOk()) redirect("/login");
  return children;
}
