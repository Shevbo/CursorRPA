import { cookies } from "next/headers";

function adminToken(): string | undefined {
  return process.env.ADMIN_TOKEN?.trim() || undefined;
}

/** ADMIN_TOKEN не задан — доступ открыт (режим отладки). */
export function adminAuthOk(req: Request): boolean {
  const token = adminToken();
  if (!token) return true;
  const h = req.headers.get("x-shectory-admin-token");
  if (h === token) return true;
  const c = cookies().get("shectory_admin")?.value;
  return c === token;
}

/** Для Server Components: есть ли валидная cookie админа. */
export function adminSessionOk(): boolean {
  const token = adminToken();
  if (!token) return true;
  return cookies().get("shectory_admin")?.value === token;
}
