/*
  Warnings:

  - You are about to drop the `pageview` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "pageview";

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "browser" VARCHAR(20),
    "os" VARCHAR(20),
    "language" VARCHAR(35),
    "country" VARCHAR(20),
    "device" VARCHAR(20),
    "referrer" VARCHAR(500),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageView" (
    "id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "url" VARCHAR(500) NOT NULL,

    CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "url" VARCHAR(500) NOT NULL,
    "type" VARCHAR(50) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventData" (
    "id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_data" JSONB NOT NULL,

    CONSTRAINT "EventData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_id_key" ON "Session"("id");

-- CreateIndex
CREATE INDEX "Session_created_at_idx" ON "Session"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "PageView_id_key" ON "PageView"("id");

-- CreateIndex
CREATE INDEX "PageView_created_at_idx" ON "PageView"("created_at");

-- CreateIndex
CREATE INDEX "PageView_session_id_idx" ON "PageView"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "Event_id_key" ON "Event"("id");

-- CreateIndex
CREATE INDEX "Event_created_at_idx" ON "Event"("created_at");

-- CreateIndex
CREATE INDEX "Event_session_id_idx" ON "Event"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "EventData_id_key" ON "EventData"("id");

-- CreateIndex
CREATE UNIQUE INDEX "EventData_event_id_key" ON "EventData"("event_id");
