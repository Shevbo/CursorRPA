#!/usr/bin/env node
// Seed script: insert 5 default AI model providers and their models
// Usage: npx tsx scripts/seed-models.mjs  (or node scripts/seed-models.mjs --import)
// We use .mjs to allow top-level await with Prisma

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PROVIDERS = [
  {
    name: "openai",
    label: "OpenAI",
    baseUrl: null,
    apiKeyRef: "model_openai_api_key",
    icon: "openai",
    enabled: true,
    models: [
      { modelId: "gpt-4o", label: "GPT-4o" },
      { modelId: "gpt-4o-mini", label: "GPT-4o Mini" },
    ],
  },
  {
    name: "anthropic",
    label: "Claude (Anthropic)",
    baseUrl: null,
    apiKeyRef: "model_claude_api_key",
    icon: "claude",
    enabled: true,
    models: [
      { modelId: "claude-opus-4", label: "Claude Opus 4" },
      { modelId: "claude-sonnet-4", label: "Claude Sonnet 4" },
    ],
  },
  {
    name: "deepseek",
    label: "DeepSeek",
    baseUrl: null,
    apiKeyRef: "model_deepseek_api_key",
    icon: "deepseek",
    enabled: true,
    models: [
      { modelId: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      { modelId: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    ],
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyRef: "model_openrouter_api_key",
    icon: "openrouter",
    enabled: true,
    models: [
      { modelId: "openrouter-auto", label: "OpenRouter (автовыбор)" },
    ],
  },
  {
    name: "ollama",
    label: "Ollama (локальные)",
    baseUrl: null, // will be read from OLLAMA_BASE_URL env
    apiKeyRef: null,
    icon: "ollama",
    enabled: true,
    models: [
      { modelId: "ollama-llama3", label: "Llama 3" },
      { modelId: "ollama-mistral", label: "Mistral" },
    ],
  },
];

async function main() {
  console.log("Seeding model providers...");

  for (const p of PROVIDERS) {
    const provider = await prisma.modelProvider.upsert({
      where: { name: p.name },
      update: {
        label: p.label,
        baseUrl: p.baseUrl,
        apiKeyRef: p.apiKeyRef,
        icon: p.icon,
        enabled: p.enabled,
      },
      create: {
        name: p.name,
        label: p.label,
        baseUrl: p.baseUrl,
        apiKeyRef: p.apiKeyRef,
        icon: p.icon,
        enabled: p.enabled,
      },
    });
    console.log(`  + Provider: ${provider.name} (${provider.id})`);

    for (const m of p.models) {
      // We don't upsert project models here — just log them
      console.log(`    - Model: ${m.modelId} (${m.label})`);
    }
  }

  console.log("\nDone! 5 providers seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
