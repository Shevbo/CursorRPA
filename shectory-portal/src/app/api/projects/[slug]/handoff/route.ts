import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { getProjectHandoffBySlug } from "@/lib/project-registry";

export async function GET(
  req: Request,
  { params }: { params: { slug: string } }
) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const handoff = await getProjectHandoffBySlug(params.slug);
    return NextResponse.json({ handoff });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build handoff" },
      { status: 404 }
    );
  }
}
