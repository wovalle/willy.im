-- CreateTable
CREATE TABLE "pageview" (
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "slug" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "pageview_slug_key" ON "pageview"("slug");

-- CreateIndex
CREATE INDEX "pageview_created_at_idx" ON "pageview"("created_at");
