import { isAdminRequest, isAdminSession } from "@/lib/portal-auth";

export function adminAuthOk(req: Request): boolean {
  // Backward compatibility is handled in portal-auth.
  return isAdminRequest(req);
}

export function adminSessionOk(): boolean {
  return isAdminSession();
}
