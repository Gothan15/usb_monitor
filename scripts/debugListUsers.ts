import { db } from "@/lib/db";
(async () => {
  const users = await (db as any).user.findMany({
    select: { id: true, username: true, createdAt: true },
  });
  console.log("USERS_DEBUG", users);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
