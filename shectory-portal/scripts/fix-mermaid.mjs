import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  const projects = await p.project.findMany({ select: { id: true, slug: true, architectureMermaid: true } });
  for (const pr of projects) {
    if (!pr.architectureMermaid) {
      console.log(pr.slug + ': EMPTY');
      continue;
    }
    // Check first char after "flowchart LR" to see if it's \n or newline
    const start = pr.architectureMermaid.indexOf('LR');
    const afterLR = start >= 0 ? pr.architectureMermaid.charCodeAt(start + 2) : -1;
    const literalBS = pr.architectureMermaid.includes('\\n');
    console.log(pr.slug + ': length=' + pr.architectureMermaid.length + ' charAfterLR=' + afterLR + ' hasLiteralSlashN=' + literalBS);
    if (afterLR === 92) { // 92 is backslash, 10 is newline
      // Has literal backslash-n, fix it
      const fixed = pr.architectureMermaid.replace(/\\n/g, '\n');
      await p.project.update({ where: { id: pr.id }, data: { architectureMermaid: fixed } });
      console.log('  -> FIXED ' + pr.slug);
    }
  }
} finally { await p.$disconnect(); }
