// =============================================
// EXPERIENCE AI — prisma/seed.ts
// Données de démonstration.
// Lancement : npm run db:seed
//
// Crée un compte de démonstration avec ses préférences de parcours, pour que
// Prisma Studio (npm run prisma:studio) affiche des données réelles.
// Idempotent : on nettoie le compte démo avant de le recréer (cascade → ses
// parcours et ses préférences partent avec).
// =============================================

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PreferencesParcoursSchema } from '../server/domaine/preferences.js';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@experience-ai.fr';

async function main() {
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });

  const password = await bcrypt.hash('demo1234', 10);

  // Les préférences passent par le même schéma que le dépôt : le seed ne peut
  // pas écrire une mémoire que l'application refuserait de relire.
  const preferences = PreferencesParcoursSchema.parse({
    ambiances: ['gastronomie', 'culture'],
    rythme: 'detendu',
    contraintes: ['pas de réveil avant 9h'],
    lieuxFavoris: [],
  });

  const user = await prisma.user.create({
    data: {
      email:    DEMO_EMAIL,
      password,
      name:     'Compte Démo',
      preferences_parcours: { create: { contenu: preferences } },
    },
  });

  console.log('Seed terminé');
  console.log(`   Utilisateur : ${user.email} (mot de passe : demo1234)`);
}

main()
  .catch((e) => { console.error('Seed échoué :', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
