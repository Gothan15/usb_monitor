import { db } from "@/lib/db";
import { verifySessionFromRequest } from "@/lib/auth";

export interface AdminContext {
  userId: string;
  username: string;
  role: string;
}

export async function requireAdminUser(
  req: Request
): Promise<AdminContext | null> {
  const session = await verifySessionFromRequest(req);
  if (!session || session.role !== "admin") {
    return null;
  }

  const user = await (db as any).user.findUnique({
    where: { username: session.username },
    select: { id: true, username: true, role: true },
  });

  if (!user) {
    return null;
  }

  return { userId: user.id, username: user.username, role: user.role };
}
