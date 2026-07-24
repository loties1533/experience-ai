-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preferences_parcours" (
    "user_id" UUID NOT NULL,
    "contenu" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "preferences_parcours_pkey" PRIMARY KEY ("user_id")
);

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

-- CreateTable
CREATE TABLE "partages_parcours" (
    "jeton" TEXT NOT NULL,
    "parcours_id" UUID NOT NULL,
    "participant_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partages_parcours_pkey" PRIMARY KEY ("jeton")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "parcours_user_id_idx" ON "parcours"("user_id");

-- CreateIndex
CREATE INDEX "partages_parcours_parcours_id_idx" ON "partages_parcours"("parcours_id");

-- CreateIndex
CREATE UNIQUE INDEX "partages_parcours_parcours_id_participant_id_key" ON "partages_parcours"("parcours_id", "participant_id");

-- AddForeignKey
ALTER TABLE "preferences_parcours" ADD CONSTRAINT "preferences_parcours_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcours" ADD CONSTRAINT "parcours_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partages_parcours" ADD CONSTRAINT "partages_parcours_parcours_id_fkey" FOREIGN KEY ("parcours_id") REFERENCES "parcours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

