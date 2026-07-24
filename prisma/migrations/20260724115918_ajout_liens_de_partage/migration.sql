-- CreateTable
CREATE TABLE "partages_parcours" (
    "jeton" TEXT NOT NULL,
    "parcours_id" UUID NOT NULL,
    "participant_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partages_parcours_pkey" PRIMARY KEY ("jeton")
);

-- CreateIndex
CREATE INDEX "partages_parcours_parcours_id_idx" ON "partages_parcours"("parcours_id");

-- CreateIndex
CREATE UNIQUE INDEX "partages_parcours_parcours_id_participant_id_key" ON "partages_parcours"("parcours_id", "participant_id");

-- AddForeignKey
ALTER TABLE "partages_parcours" ADD CONSTRAINT "partages_parcours_parcours_id_fkey" FOREIGN KEY ("parcours_id") REFERENCES "parcours"("id") ON DELETE CASCADE ON UPDATE CASCADE;
