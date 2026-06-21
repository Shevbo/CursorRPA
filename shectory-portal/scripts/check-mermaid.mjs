import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  const projects = await p.project.findMany({ select: { slug: true, architectureMermaid: true } });
  for (const pr of projects) {
    console.log(pr.slug + ': ' + (pr.architectureMermaid || 'EMPTY').replace(/\\n/g, '|').substring(0, 120));
  }
} finally { await p.$disconnect(); }
