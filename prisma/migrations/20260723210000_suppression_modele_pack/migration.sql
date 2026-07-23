-- Sprint R6b — suppression du modèle Pack hérité de TripGenie.
-- Le Parcours (table `parcours`, ADR-0007) est désormais le seul modèle de
-- domaine : les tables ci-dessous n'ont plus ni code ni route qui les lise.
-- Écrite à la main (base indisponible au moment du nettoyage), format
-- identique à ce que produit `prisma migrate dev`.

-- DropForeignKey
ALTER TABLE "trip_votes" DROP CONSTRAINT "trip_votes_pack_id_fkey";

-- DropForeignKey
ALTER TABLE "trip_collaborators" DROP CONSTRAINT "trip_collaborators_trip_id_fkey";

-- DropForeignKey
ALTER TABLE "trip_collaborators" DROP CONSTRAINT "trip_collaborators_user_id_fkey";

-- DropForeignKey
ALTER TABLE "packs" DROP CONSTRAINT "packs_trip_id_fkey";

-- DropForeignKey
ALTER TABLE "trips" DROP CONSTRAINT "trips_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_preferences" DROP CONSTRAINT "user_preferences_user_id_fkey";

-- DropTable
DROP TABLE "trip_votes";

-- DropTable
DROP TABLE "trip_collaborators";

-- DropTable
DROP TABLE "packs";

-- DropTable
DROP TABLE "trips";

-- DropTable
DROP TABLE "user_preferences";
