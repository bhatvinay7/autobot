-- CreateEnum
CREATE TYPE "InteractionStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'DEDUPLICATED');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('BOT_REPLY', 'MIRROR_SLACK', 'MIRROR_DISCORD', 'AI_TAG');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('SUCCESS', 'FAILED', 'RETRYING', 'DLQ');

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "guildId" TEXT,
    "channelId" TEXT,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "commandOptions" JSONB NOT NULL DEFAULT '[]',
    "status" "InteractionStatus" NOT NULL DEFAULT 'PENDING',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "aiSummary" TEXT,
    "aiTags" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "interactionDbId" TEXT NOT NULL,
    "type" "ActionType" NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'RETRYING',
    "payload" JSONB NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mirrorEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "customResponse" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommandConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Interaction_interactionId_key" ON "Interaction"("interactionId");

-- CreateIndex
CREATE INDEX "Interaction_guildId_idx" ON "Interaction"("guildId");

-- CreateIndex
CREATE INDEX "Interaction_userId_idx" ON "Interaction"("userId");

-- CreateIndex
CREATE INDEX "Interaction_commandName_idx" ON "Interaction"("commandName");

-- CreateIndex
CREATE INDEX "Interaction_receivedAt_idx" ON "Interaction"("receivedAt");

-- CreateIndex
CREATE INDEX "Interaction_status_idx" ON "Interaction"("status");

-- CreateIndex
CREATE INDEX "Action_interactionDbId_idx" ON "Action"("interactionDbId");

-- CreateIndex
CREATE INDEX "Action_status_idx" ON "Action"("status");

-- CreateIndex
CREATE INDEX "CommandConfig_guildId_idx" ON "CommandConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "CommandConfig_guildId_commandName_key" ON "CommandConfig"("guildId", "commandName");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_token_key" ON "AdminSession"("token");

-- CreateIndex
CREATE INDEX "AdminSession_token_idx" ON "AdminSession"("token");

-- CreateIndex
CREATE INDEX "AdminSession_userId_idx" ON "AdminSession"("userId");

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_interactionDbId_fkey" FOREIGN KEY ("interactionDbId") REFERENCES "Interaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
