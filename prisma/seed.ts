// =============================================
// TRIPGENIE — prisma/seed.ts
// Données de démonstration pour le demo day.
// Lancement : npm run db:seed
//
// Crée un utilisateur démo + un voyage exemple, pour que Prisma Studio
// (npm run prisma:studio) affiche des données réelles pendant la présentation.
// Idempotent : on nettoie l'utilisateur démo avant de recréer.
// =============================================

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@tripgenie.fr';

async function main() {
  // Nettoyage idempotent (cascade → trips/packs/prefs supprimés aussi)
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });

  const password = await bcrypt.hash('demo1234', 10);

  const user = await prisma.user.create({
    data: {
      email:    DEMO_EMAIL,
      password,
      name:     'Compte Démo',
      preferences: {
        create: {
          default_mode:    'relax',
          default_premium: true,
          preferred_prefs: ['gastronomie', 'culture', 'nightlife'],
          home_city:       'Paris',
          currency:        'EUR',
        },
      },
    },
  });

  const trip = await prisma.trip.create({
    data: {
      user_id:     user.id,
      title:       'Week-end à Lisbonne',
      destination: 'Lisbonne',
      country:     'Portugal',
      origin:      'Paris',
      departure:   new Date('2026-08-15'),
      return_date: new Date('2026-08-22'),
      travelers:   4,
      budget:      '5000',
      mode:        'party',
      status:      'draft',
      score:       0.82,
      pack_data:   { destination: 'Lisbonne', tagline: 'La perle de l\'Atlantique' },
      packs: {
        create: {
          rank:      1,
          score:     0.82,
          selected:  true,
          pack_data: { destination: 'Lisbonne', hotels: [], activities: [] },
        },
      },
    },
    include: { packs: true },
  });

  console.log('✅ Seed terminé');
  console.log(`   Utilisateur : ${user.email} (mot de passe : demo1234)`);
  console.log(`   Voyage      : ${trip.title} (${trip.id})`);
  console.log(`   Pack        : rang ${trip.packs[0]?.rank}`);
}

main()
  .catch((e) => { console.error('❌ Seed échoué:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
