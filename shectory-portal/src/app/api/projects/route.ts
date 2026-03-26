import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { createProjectWithWorkspace } from "@/lib/project-registry";

type Body = {
  slug?: string;
  name?: string;
  repoName?: string;
  visibility?: "private" | "public";
  owner?: string;
  maintainer?: string;
  stage?: string;
  status?: string;
  docsUrl?: string;
  boardUrl?: string;
  runbookUrl?: string;
};

export async function POST(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.slug?.trim() || !body.name?.trim() || !body.repoName?.trim() || !body.owner?.trim()) {
    return NextResponse.json(
      { error: "slug, name, repoName, owner are required" },
      { status: 400 }
    );
  }
  const visibility = body.visibility === "public" ? "public" : "private";

  try {
    const result = await createProjectWithWorkspace({
      slug: body.slug.trim(),
      name: body.name.trim(),
      repoName: body.repoName.trim(),
      visibility,
      owner: body.owner.trim(),
      maintainer: body.maintainer?.trim(),
      stage: body.stage?.trim(),
      status: body.status?.trim(),
      docsUrl: body.docsUrl?.trim(),
      boardUrl: body.boardUrl?.trim(),
      runbookUrl: body.runbookUrl?.trim(),
    });
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create project failed" },
      { status: 400 }
    );
  }
}
