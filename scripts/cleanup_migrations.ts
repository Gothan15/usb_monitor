import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const migrationsToDelete = [
    '20251112120000_init_schema',
    '20251113120000_add_agent_role',
    '20251113153000_remove_pending_unlock',
    '20251113160000_remove_agent_role'
  ];

  console.log('Cleaning up old migration history...');

  for (const migrationName of migrationsToDelete) {
    try {
        const result = await prisma.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE "migration_name" = '${migrationName}'`);
        console.log(`Deleted ${migrationName}: ${result}`);
    } catch (e) {
        console.error(`Failed to delete ${migrationName}`, e);
    }
  }
    
    console.log('Finished cleanup.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
