import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const MAX_DESC = 50_000;
const MAX_MERMAID = 200_000;
const MAX_URL = 2048;

type PatchBody = {
  name?: unknown;
  description?: unknown;
  architectureMermaid?: unknown;
  uiUrl?: unknown;
  stage?: unknown;
  registryMetaJson?: unknown;
};

export async function PATCH(req: Request, { params }: { params: { slug: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const slug = params.slug?.trim();
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: {
    name?: string;
    description?: string;
    architectureMermaid?: string;
    uiUrl?: string | null;
    stage?: string;
    registryMetaJson?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "name must be a string" }, { status: 400 });
    }
    const clean = body.name.trim();
    if (!clean) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    data.name = clean.slice(0, 120);
  }

  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      return NextResponse.json({ error: "description must be a string" }, { status: 400 });
    }
    data.description = body.description.slice(0, MAX_DESC);
  }

  if (body.architectureMermaid !== undefined) {
    if (typeof body.architectureMermaid !== "string") {
      return NextResponse.json({ error: "architectureMermaid must be a string" }, { status: 400 });
    }
    data.architectureMermaid = body.architectureMermaid.slice(0, MAX_MERMAID);
  }

  if (body.uiUrl !== undefined) {
    if (body.uiUrl === null) {
      data.uiUrl = null;
    } else if (typeof body.uiUrl === "string") {
      const raw = body.uiUrl.trim();
      if (!raw) data.uiUrl = null;
      else {
        try {
          const u = new URL(raw);
          if (u.protocol !== "http:" && u.protocol !== "https:") {
            return NextResponse.json({ error: "uiUrl must be http(s) URL" }, { status: 400 });
          }
          data.uiUrl = u.toString().slice(0, MAX_URL);
        } catch {
          return NextResponse.json({ error: "uiUrl must be valid URL" }, { status: 400 });
        }
      }
    } else {
      return NextResponse.json({ error: "uiUrl must be string or null" }, { status: 400 });
    }
  }

  if (body.stage !== undefined) {
    if (typeof body.stage !== "string") {
      return NextResponse.json({ error: "stage must be a string" }, { status: 400 });
    }
    const allowed = new Set(["dev", "mvp", "prod", "archive"]);
    const clean = body.stage.trim().toLowerCase();
    if (!allowed.has(clean)) {
      return NextResponse.json({ error: "stage must be one of: dev, mvp, prod, archive" }, { status: 400 });
    }
    data.stage = clean;
  }

  if (body.registryMetaJson !== undefined) {
    // Intentionally flexible: validated at UI layer. Secrets запрещены организационно, не технически.
    // Ensure value is JSON-serializable (prisma expects InputJsonValue).
    try {
      JSON.stringify(body.registryMetaJson);
    } catch {
      return NextResponse.json({ error: "registryMetaJson must be JSON-serializable" }, { status: 400 });
    }
    data.registryMetaJson = body.registryMetaJson as Prisma.InputJsonValue;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Provide at least one updatable field" },
      { status: 400 }
    );
  }

  try {
    const updated = await prisma.project.update({
      where: { slug },
      data,
      select: { id: true, slug: true, name: true, stage: true, description: true, architectureMermaid: true, uiUrl: true, registryMetaJson: true },
    });
    return NextResponse.json({ ok: true, project: updated });
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
}
