import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PROVIDER_API: Record<string, { baseUrl: string; headers: Record<string, string>; path: string; bodyFn: (modelId: string, msg: string) => unknown; extractFn: (json: any) => string }> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    headers: { "Content-Type": "application/json" },
    path: "/chat/completions",
    bodyFn: (modelId, msg) => ({
      model: modelId,
      messages: [{ role: "user", content: msg }],
      max_tokens: 200,
      stream: false,
    }),
    extractFn: (json) => json?.choices?.[0]?.message?.content ?? JSON.stringify(json),
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
    path: "/messages",
    bodyFn: (modelId, msg) => ({
      model: modelId,
      max_tokens: 200,
      messages: [{ role: "user", content: msg }],
    }),
    extractFn: (json) => json?.content?.[0]?.text ?? JSON.stringify(json),
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    headers: { "Content-Type": "application/json" },
    path: "/chat/completions",
    bodyFn: (modelId, msg) => ({
      model: modelId,
      messages: [{ role: "user", content: msg }],
      max_tokens: 200,
      stream: false,
    }),
    extractFn: (json) => json?.choices?.[0]?.message?.content ?? JSON.stringify(json),
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    headers: { "Content-Type": "application/json" },
    path: "/chat/completions",
    bodyFn: (modelId, msg) => ({
      model: modelId,
      messages: [{ role: "user", content: msg }],
      max_tokens: 200,
      stream: false,
    }),
    extractFn: (json) => json?.choices?.[0]?.message?.content ?? JSON.stringify(json),
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    headers: { "Content-Type": "application/json" },
    path: "/models/", // will be appended with modelId:generateContent
    bodyFn: (modelId, msg) => ({
      contents: [{ parts: [{ text: msg }] }],
      generationConfig: { maxOutputTokens: 200 },
    }),
    extractFn: (json) => json?.candidates?.[0]?.content?.parts?.[0]?.text ?? JSON.stringify(json),
  },
};

export async function POST(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { providerName?: string; modelId?: string; apiKey?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const providerName = body.providerName?.trim();
  const modelId = body.modelId?.trim();
  if (!providerName || !modelId) {
    return NextResponse.json({ error: "providerName and modelId required" }, { status: 400 });
  }

  const msg = body.message || "Say 'Hello! I am working.' and nothing else.";

  // Handle Ollama separately (local)
  if (providerName === "ollama") {
    return handleOllamaTest(modelId, msg);
  }

  const apiConfig = PROVIDER_API[providerName];
  if (!apiConfig) {
    return NextResponse.json({ error: "Unknown provider: " + providerName }, { status: 400 });
  }

  // Get API key from DB or from request body
  let apiKey = body.apiKey?.trim();
  if (!apiKey) {
    const provider = await prisma.modelProvider.findUnique({ where: { name: providerName } });
    if (provider?.apiKeyRef) {
      const settingRow = await prisma.portalSetting.findUnique({ where: { key: provider.apiKeyRef } });
      if (settingRow?.value) apiKey = settingRow.value;
    }
  }
  if (!apiKey) {
    return NextResponse.json({ error: "API key not found. Set it in Settings first." }, { status: 400 });
  }

  const startTime = Date.now();

  // Build URL and headers
  let url: string;
  const headers: Record<string, string> = {
    ...apiConfig.headers,
  };

  if (providerName === "gemini") {
    // Gemini uses API key as query param
    url = apiConfig.baseUrl + apiConfig.path + modelId + ":generateContent?key=" + encodeURIComponent(apiKey);
  } else {
    url = apiConfig.baseUrl + apiConfig.path;
    headers["Authorization"] = "Bearer " + apiKey;
  }

  const payload = apiConfig.bodyFn(modelId, msg);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const elapsed = Date.now() - startTime;
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg = json?.error?.message || json?.error || JSON.stringify(json).slice(0, 200);
      return NextResponse.json({
        ok: false,
        error: errMsg,
        elapsedMs: elapsed,
      });
    }

    const reply = apiConfig.extractFn(json);
    const tokenEstimate = reply.split(/\s+/).length;
    const tokensPerSec = elapsed > 0 ? ((tokenEstimate / elapsed) * 1000).toFixed(1) : "?";

    return NextResponse.json({
      ok: true,
      response: reply,
      elapsedMs: elapsed,
      tokensPerSec: tokensPerSec + " tok/s (est.)",
    });
  } catch (e: any) {
    const elapsed = Date.now() - startTime;
    return NextResponse.json({
      ok: false,
      error: e?.message || String(e),
      elapsedMs: elapsed,
    });
  }
}

async function handleOllamaTest(modelId: string, _msg?: string) {
  const msg = _msg || "Say 'Hello! I am working.' and nothing else.";
  const url = "http://localhost:11434/api/chat";
  const startTime = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: msg }],
        stream: false,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const elapsed = Date.now() - startTime;
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        error: json?.error || JSON.stringify(json).slice(0, 200),
        elapsedMs: elapsed,
      });
    }

    const reply = json?.message?.content || JSON.stringify(json);
    const tokenEstimate = reply.split(/\s+/).length;
    const tokensPerSec = elapsed > 0 ? ((tokenEstimate / elapsed) * 1000).toFixed(1) : "?";

    return NextResponse.json({
      ok: true,
      response: reply,
      elapsedMs: elapsed,
      tokensPerSec: tokensPerSec + " tok/s (est.)",
    });
  } catch (e: any) {
    const elapsed = Date.now() - startTime;
    return NextResponse.json({
      ok: false,
      error: e?.message || String(e),
      elapsedMs: elapsed,
    });
  }
}
