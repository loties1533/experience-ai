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
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "country" TEXT,
    "origin" TEXT,
    "departure" DATE,
    "return_date" DATE,
    "travelers" INTEGER NOT NULL DEFAULT 1,
    "budget" TEXT,
    "mode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "score" DOUBLE PRECISION,
    "pack_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packs" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 1,
    "score" DOUBLE PRECISION,
    "pack_data" JSONB NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_votes" (
    "id" UUID NOT NULL,
    "pack_id" UUID NOT NULL,
    "item_id" TEXT NOT NULL,
    "voter_name" TEXT NOT NULL DEFAULT 'Anonyme',
    "vote_type" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "default_mode" TEXT NOT NULL DEFAULT 'party',
    "preferred_prefs" TEXT[],
    "home_city" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "trip_collaborators" (
    "trip_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "invited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_collaborators_pkey" PRIMARY KEY ("trip_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "trips_user_id_idx" ON "trips"("user_id");

-- CreateIndex
CREATE INDEX "trips_mode_idx" ON "trips"("mode");

-- CreateIndex
CREATE INDEX "packs_trip_id_idx" ON "packs"("trip_id");

-- CreateIndex
CREATE INDEX "trip_votes_pack_id_idx" ON "trip_votes"("pack_id");

-- CreateIndex
CREATE INDEX "trip_collaborators_user_id_idx" ON "trip_collaborators"("user_id");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packs" ADD CONSTRAINT "packs_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_votes" ADD CONSTRAINT "trip_votes_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_collaborators" ADD CONSTRAINT "trip_collaborators_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_collaborators" ADD CONSTRAINT "trip_collaborators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
