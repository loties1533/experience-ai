-- CreateTable
CREATE TABLE "preferences_parcours" (
    "user_id" UUID NOT NULL,
    "contenu" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "preferences_parcours_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "preferences_parcours" ADD CONSTRAINT "preferences_parcours_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
