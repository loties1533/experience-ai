-- CreateTable
CREATE TABLE "parcours" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "intention" TEXT NOT NULL,
    "visibilite" TEXT NOT NULL DEFAULT 'prive',
    "contenu" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parcours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parcours_user_id_idx" ON "parcours"("user_id");

-- AddForeignKey
ALTER TABLE "parcours" ADD CONSTRAINT "parcours_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
