-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('DEVELOPER', 'ADMIN');

-- CreateEnum
CREATE TYPE "SuiteVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ContentReviewStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('NATLAS', 'FIXTURE');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('PASSED', 'FAILED', 'NEEDS_REVIEW', 'SKIPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConsistencyVerdict" AS ENUM ('CONSISTENT', 'INCONSISTENT', 'NEEDS_REVIEW', 'INSUFFICIENT_DATA');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'DEVELOPER',
    "onboardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelConfiguration" (
    "id" UUID NOT NULL,
    "key" TEXT,
    "projectId" UUID,
    "name" TEXT NOT NULL,
    "providerType" "ProviderType" NOT NULL,
    "modelIdentifier" TEXT NOT NULL,
    "modelRevision" TEXT,
    "endpointReference" TEXT NOT NULL,
    "supportedLanguages" TEXT[],
    "defaultParameters" JSONB NOT NULL,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkSuite" (
    "id" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT NOT NULL,
    "visibility" "SuiteVisibility" NOT NULL DEFAULT 'PRIVATE',
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" UUID,
    "contentHash" TEXT NOT NULL,
    "formatVersion" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenchmarkSuite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticGroup" (
    "id" UUID NOT NULL,
    "suiteId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "expectedFacts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SemanticGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkCase" (
    "id" UUID NOT NULL,
    "suiteId" UUID NOT NULL,
    "semanticGroupId" UUID,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "prompt" TEXT NOT NULL,
    "factIds" TEXT[],
    "expectedFacts" JSONB NOT NULL,
    "requiredTerms" TEXT[],
    "forbiddenTerms" TEXT[],
    "evaluationRules" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "reviewStatus" "ContentReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "tags" TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenchmarkCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationRun" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "benchmarkSuiteId" UUID NOT NULL,
    "benchmarkVersion" TEXT NOT NULL,
    "benchmarkContentHash" TEXT NOT NULL,
    "modelConfigurationId" UUID NOT NULL,
    "providerType" "ProviderType" NOT NULL,
    "modelIdentifier" TEXT NOT NULL,
    "modelRevision" TEXT,
    "isSimulated" BOOLEAN NOT NULL,
    "inferenceConfig" JSONB NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "languages" TEXT[],
    "selection" JSONB NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "totalCases" INTEGER NOT NULL,
    "completedCases" INTEGER NOT NULL DEFAULT 0,
    "failedCases" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "providerMetadata" JSONB,
    "errorDetails" JSONB,
    "cancelRequestedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationResult" (
    "id" UUID NOT NULL,
    "evaluationRunId" UUID NOT NULL,
    "benchmarkCaseId" UUID NOT NULL,
    "semanticGroupId" UUID,
    "caseKey" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "caseSnapshot" JSONB NOT NULL,
    "executionStatus" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "response" TEXT,
    "responseTimeMs" INTEGER,
    "providerInferenceMs" INTEGER,
    "requestId" TEXT,
    "providerRequestId" TEXT,
    "responseMetadata" JSONB,
    "verdict" "Verdict",
    "finalVerdict" "Verdict",
    "checks" JSONB,
    "factChecks" JSONB,
    "languageDetection" JSONB,
    "summary" TEXT,
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "errorDetails" JSONB,
    "startedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsistencyResult" (
    "id" UUID NOT NULL,
    "evaluationRunId" UUID NOT NULL,
    "semanticGroupId" UUID NOT NULL,
    "semanticGroupKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "languagesCompared" TEXT[],
    "languagesMissing" TEXT[],
    "findings" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "verdict" "ConsistencyVerdict" NOT NULL,
    "method" TEXT NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsistencyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanReview" (
    "id" UUID NOT NULL,
    "evaluationResultId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "previousVerdict" "Verdict",
    "notes" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetaFeedback" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "testerIdentifier" TEXT NOT NULL,
    "developerBackground" TEXT,
    "projectVersion" TEXT NOT NULL,
    "testedFeatures" TEXT[],
    "easeOfUseRating" INTEGER,
    "mostUsefulFeature" TEXT,
    "problemsEncountered" TEXT,
    "suggestions" TEXT,
    "overallAssessment" TEXT NOT NULL,
    "consentRecorded" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Project_ownerId_archivedAt_idx" ON "Project"("ownerId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelConfiguration_key_key" ON "ModelConfiguration"("key");

-- CreateIndex
CREATE INDEX "ModelConfiguration_projectId_idx" ON "ModelConfiguration"("projectId");

-- CreateIndex
CREATE INDEX "BenchmarkSuite_visibility_archivedAt_idx" ON "BenchmarkSuite"("visibility", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkSuite_namespace_slug_version_key" ON "BenchmarkSuite"("namespace", "slug", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SemanticGroup_suiteId_key_key" ON "SemanticGroup"("suiteId", "key");

-- CreateIndex
CREATE INDEX "BenchmarkCase_suiteId_language_idx" ON "BenchmarkCase"("suiteId", "language");

-- CreateIndex
CREATE INDEX "BenchmarkCase_semanticGroupId_idx" ON "BenchmarkCase"("semanticGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkCase_suiteId_key_key" ON "BenchmarkCase"("suiteId", "key");

-- CreateIndex
CREATE INDEX "EvaluationRun_projectId_createdAt_idx" ON "EvaluationRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "EvaluationRun_status_queuedAt_idx" ON "EvaluationRun"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "EvaluationResult_evaluationRunId_executionStatus_idx" ON "EvaluationResult"("evaluationRunId", "executionStatus");

-- CreateIndex
CREATE INDEX "EvaluationResult_evaluationRunId_language_idx" ON "EvaluationResult"("evaluationRunId", "language");

-- CreateIndex
CREATE INDEX "EvaluationResult_evaluationRunId_finalVerdict_idx" ON "EvaluationResult"("evaluationRunId", "finalVerdict");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationResult_evaluationRunId_benchmarkCaseId_key" ON "EvaluationResult"("evaluationRunId", "benchmarkCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsistencyResult_evaluationRunId_semanticGroupId_key" ON "ConsistencyResult"("evaluationRunId", "semanticGroupId");

-- CreateIndex
CREATE INDEX "HumanReview_evaluationResultId_idx" ON "HumanReview"("evaluationResultId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "BetaFeedback_createdAt_idx" ON "BetaFeedback"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelConfiguration" ADD CONSTRAINT "ModelConfiguration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkSuite" ADD CONSTRAINT "BenchmarkSuite_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticGroup" ADD CONSTRAINT "SemanticGroup_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "BenchmarkSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkCase" ADD CONSTRAINT "BenchmarkCase_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "BenchmarkSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkCase" ADD CONSTRAINT "BenchmarkCase_semanticGroupId_fkey" FOREIGN KEY ("semanticGroupId") REFERENCES "SemanticGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkCase" ADD CONSTRAINT "BenchmarkCase_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_benchmarkSuiteId_fkey" FOREIGN KEY ("benchmarkSuiteId") REFERENCES "BenchmarkSuite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_modelConfigurationId_fkey" FOREIGN KEY ("modelConfigurationId") REFERENCES "ModelConfiguration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationResult" ADD CONSTRAINT "EvaluationResult_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "EvaluationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationResult" ADD CONSTRAINT "EvaluationResult_benchmarkCaseId_fkey" FOREIGN KEY ("benchmarkCaseId") REFERENCES "BenchmarkCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsistencyResult" ADD CONSTRAINT "ConsistencyResult_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "EvaluationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsistencyResult" ADD CONSTRAINT "ConsistencyResult_semanticGroupId_fkey" FOREIGN KEY ("semanticGroupId") REFERENCES "SemanticGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanReview" ADD CONSTRAINT "HumanReview_evaluationResultId_fkey" FOREIGN KEY ("evaluationResultId") REFERENCES "EvaluationResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanReview" ADD CONSTRAINT "HumanReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetaFeedback" ADD CONSTRAINT "BetaFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
