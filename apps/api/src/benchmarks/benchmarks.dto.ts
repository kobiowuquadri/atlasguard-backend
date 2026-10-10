import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { BENCHMARK_CATEGORIES, SUPPORTED_LANGUAGES } from '@atlasguard/shared';
import { PaginationQueryDto } from '../common/pagination';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true';

export class ListBenchmarksQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Only suites containing cases in this language. */
  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  language?: string;

  @IsOptional()
  @IsIn(BENCHMARK_CATEGORIES)
  category?: string;
}

export class ListCasesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  language?: string;

  @IsOptional()
  @IsIn(BENCHMARK_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED'])
  reviewStatus?: string;

  @IsOptional()
  @IsUUID()
  semanticGroupId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ImportBenchmarkDto {
  /** A dataset in AtlasGuard benchmark format (formatVersion 1). */
  @IsObject()
  dataset: Record<string, unknown>;

  /** Validate only; nothing is saved. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  dryRun?: boolean;

  /** Administrators only: import as an official AtlasGuard suite. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  official?: boolean;
}

export class ReviewCaseDto {
  @IsIn(['VERIFIED', 'REJECTED', 'PENDING_REVIEW'])
  status: 'VERIFIED' | 'REJECTED' | 'PENDING_REVIEW';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /**
   * Required for VERIFIED: the reviewer confirms they are fluent in the case language and
   * checked the prompt, translation and reference facts.
   */
  @ValidateIf((o: ReviewCaseDto) => o.status === 'VERIFIED')
  @Equals(true, { message: 'attestation must be true to verify content' })
  attestation?: boolean;
}
