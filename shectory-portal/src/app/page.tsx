import { redirect } from "next/navigation";
import { adminSessionOk } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (adminSessionOk()) redirect("/projects");
  redirect("/login");
}
