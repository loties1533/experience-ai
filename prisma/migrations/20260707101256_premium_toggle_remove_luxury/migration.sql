-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "premium" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "default_premium" BOOLEAN NOT NULL DEFAULT false;

-- Backfill : le mode 'luxury' est supprimé. Il mélangeait vibe + niveau de prix ;
-- on le décompose en (vibe 'relax' + premium=true), l'axe prix étant désormais séparé.
UPDATE "trips"
   SET "premium" = true,
       "mode"    = 'relax'
 WHERE "mode" = 'luxury';

UPDATE "user_preferences"
   SET "default_premium" = true,
       "default_mode"    = 'relax'
 WHERE "default_mode" = 'luxury';
