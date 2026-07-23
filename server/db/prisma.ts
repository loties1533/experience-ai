// =============================================
// TRIPGENIE — server/db/prisma.ts
// Client Prisma singleton.
//
// Sécurité d'isolation des données : filtre applicatif systématique
// `where: { user_id }` dans chaque route protégée (le JWT fournit l'id).
//
// Pattern singleton : en dev (nodemon/tsx recharge à chaque sauvegarde),
// on réutilise l'instance stockée sur globalThis pour éviter d'épuiser
// le pool de connexions PostgreSQL à chaque hot-reload.
// =============================================

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
