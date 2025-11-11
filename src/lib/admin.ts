import { requireAuth } from "@/lib/auth";

export interface AdminContext {
  userId: string;
  username: string;
  role: string;
}

export async function requireAdminUser(
  req: Request
): Promise<AdminContext | null> {
  try {
    const user = await requireAuth(req, { role: "admin" });
    return { userId: user.userId, username: user.username, role: user.role };
  } catch {
    return null;
  }
}
