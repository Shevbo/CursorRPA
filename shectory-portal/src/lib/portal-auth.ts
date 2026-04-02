import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "shectory_admin_session";
const LEGACY_COOKIE = "shectory_admin";
const DEFAULT_ADMIN_EMAIL = "bshevelev@mail.ru";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const CODE_TTL_MINUTES = 15;
let cachedSecret: string | null = null;

type SessionPayload = {
  email: string;
  role: string;
  exp: number;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function authSecret(): string | undefined {
  if (cachedSecret) return cachedSecret;
  const explicit =
    process.env.AUTH_SESSION_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    process.env.ADMIN_TOKEN?.trim() ||
    "";
  if (explicit) {
    cachedSecret = explicit;
    return cachedSecret;
  }
  // Fallback key to avoid broken login when env secret was not configured yet.
  // Deterministic per installation, but admins should still set AUTH_SESSION_SECRET explicitly.
  const base = `${process.env.DATABASE_URL || "db"}|${process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL}|shectory-auth`;
  cachedSecret = createHmac("sha256", "shectory-fallback-secret").update(base).digest("hex");
  return cachedSecret;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expectedHex] = parts;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function signPayload(payload: SessionPayload): string {
  const secret = authSecret();
  if (!secret) return "";
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return `v1.${body}.${sig}`;
}

function parseSession(value: string | undefined): SessionPayload | null {
  if (!value || !value.startsWith("v1.")) return null;
  const secret = authSecret();
  if (!secret) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [, body, sig] = parts;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!data?.email || !data?.role || !Number.isFinite(data?.exp)) return null;
    if (Date.now() >= data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return "Пароль должен быть не короче 8 символов";
  if (!/[A-Za-zА-Яа-я]/.test(password) || !/\d/.test(password)) {
    return "Пароль должен содержать буквы и цифры";
  }
  return null;
}

export async function ensureDefaultAdminUser() {
  const email = normalizeEmail(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL);
  await prisma.portalUser.upsert({
    where: { email },
    create: { email, role: "superadmin" },
    update: { role: "superadmin" },
  });
}

export async function findPortalUser(emailRaw: string) {
  const email = normalizeEmail(emailRaw);
  return prisma.portalUser.findUnique({ where: { email } });
}

export async function setPortalUserPassword(emailRaw: string, password: string, verifyEmail = false) {
  const email = normalizeEmail(emailRaw);
  const hash = hashPassword(password);
  return prisma.portalUser.upsert({
    where: { email },
    create: {
      email,
      role: email === normalizeEmail(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL) ? "superadmin" : "user",
      passwordHash: hash,
      emailVerifiedAt: verifyEmail ? new Date() : null,
    },
    update: {
      passwordHash: hash,
      ...(verifyEmail ? { emailVerifiedAt: new Date() } : {}),
    },
  });
}

export function passwordMatches(password: string, hash: string | null): boolean {
  if (!hash) return false;
  return verifyPassword(password, hash);
}

export function issueSessionCookie(role: string, emailRaw: string): { name: string; value: string; maxAge: number } {
  const payload: SessionPayload = {
    email: normalizeEmail(emailRaw),
    role,
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  return { name: COOKIE_NAME, value: signPayload(payload), maxAge: SESSION_TTL_SECONDS };
}

export function clearSessionCookie(res: { cookies: { set: (...args: any[]) => unknown } }) {
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0, sameSite: "lax" });
  res.cookies.set(LEGACY_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0, sameSite: "lax" });
}

export function currentPortalSessionFromCookies(): SessionPayload | null {
  const c = cookies();
  const parsed = parseSession(c.get(COOKIE_NAME)?.value);
  if (parsed) return parsed;
  const legacy = c.get(LEGACY_COOKIE)?.value;
  const legacyToken = process.env.ADMIN_TOKEN?.trim();
  if (legacyToken && legacy === legacyToken) {
    return { email: normalizeEmail(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL), role: "admin", exp: Date.now() + 60_000 };
  }
  return null;
}

export function currentPortalSessionFromRequest(req: Request): SessionPayload | null {
  const cookieHeader = req.headers.get("cookie") || "";
  const m = cookieHeader.match(/(?:^|;\s*)shectory_admin_session=([^;]+)/);
  const parsed = parseSession(m ? decodeURIComponent(m[1]) : undefined);
  if (parsed) return parsed;
  const h = req.headers.get("x-shectory-admin-token");
  const token = process.env.ADMIN_TOKEN?.trim();
  if (token && h === token) {
    return { email: normalizeEmail(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL), role: "admin", exp: Date.now() + 60_000 };
  }
  const mLegacy = cookieHeader.match(/(?:^|;\s*)shectory_admin=([^;]+)/);
  const legacy = mLegacy ? decodeURIComponent(mLegacy[1]) : "";
  if (token && legacy === token) {
    return { email: normalizeEmail(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL), role: "admin", exp: Date.now() + 60_000 };
  }
  return null;
}

export async function createEmailCode(emailRaw: string, purpose: "register" | "reset"): Promise<{ delivery: string; debugCode?: string }> {
  const email = normalizeEmail(emailRaw);
  const user = await prisma.portalUser.upsert({
    where: { email },
    create: { email, role: "user" },
    update: {},
  });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await prisma.portalEmailCode.create({
    data: {
      userId: user.id,
      purpose,
      code,
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    },
  });
  return deliverAuthCode(email, code, purpose);
}

async function deliverAuthCode(email: string, code: string, purpose: string): Promise<{ delivery: string; debugCode?: string }> {
  const from = process.env.AUTH_EMAIL_FROM?.trim();
  const mode = process.env.AUTH_CODE_DELIVERY_MODE?.trim() || "log";
  const subject = purpose === "reset" ? "Shectory: код сброса пароля" : "Shectory: код подтверждения e-mail";
  const body = `Код: ${code}\nДействителен ${CODE_TTL_MINUTES} минут.`;

  if (mode === "smtp" && from && process.env.SMTP_HOST) {
    // SMTP-интеграция включается отдельно; пока безопасный fallback в log/debug.
    console.log(`[AUTH_EMAIL SMTP PLACEHOLDER] to=${email} subject=${subject} body=${body}`);
    return { delivery: "smtp-placeholder" };
  }
  console.log(`[AUTH_EMAIL LOG] to=${email} subject=${subject} body=${body}`);
  if (process.env.NODE_ENV !== "production") return { delivery: "log", debugCode: code };
  return { delivery: "log" };
}

export async function consumeEmailCode(emailRaw: string, purpose: "register" | "reset", codeRaw: string): Promise<boolean> {
  const email = normalizeEmail(emailRaw);
  const code = codeRaw.trim();
  if (!code) return false;
  const user = await prisma.portalUser.findUnique({ where: { email }, select: { id: true } });
  if (!user) return false;
  const record = await prisma.portalEmailCode.findFirst({
    where: {
      userId: user.id,
      purpose,
      code,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return false;
  await prisma.portalEmailCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
  return true;
}

export function isAdminRequest(req: Request): boolean {
  const s = currentPortalSessionFromRequest(req);
  return s?.role === "admin" || s?.role === "superadmin";
}

export function isAdminSession(): boolean {
  const s = currentPortalSessionFromCookies();
  return s?.role === "admin" || s?.role === "superadmin";
}

export function isSuperAdminSession(): boolean {
  return currentPortalSessionFromCookies()?.role === "superadmin";
}

export function isSuperAdminRequest(req: Request): boolean {
  return currentPortalSessionFromRequest(req)?.role === "superadmin";
}

/** CUID пользователя портала для текущей админ-сессии (уведомления, аудит). */
export async function portalUserIdFromRequest(req: Request): Promise<string | null> {
  const s = currentPortalSessionFromRequest(req);
  if (!s?.email) return null;
  const email = normalizeEmail(s.email);
  const u = await prisma.portalUser.findUnique({ where: { email }, select: { id: true } });
  return u?.id ?? null;
}

export async function portalUserIdFromCookies(): Promise<string | null> {
  const s = currentPortalSessionFromCookies();
  if (!s?.email) return null;
  const email = normalizeEmail(s.email);
  const u = await prisma.portalUser.findUnique({ where: { email }, select: { id: true } });
  return u?.id ?? null;
}

export function currentUserEmail(): string | null {
  const s = currentPortalSessionFromCookies();
  return s?.email ?? null;
}

