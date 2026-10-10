import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BENCHMARK_CATEGORIES, SUPPORTED_LANGUAGES, VERDICTS } from '@atlasguard/shared';
import { PaginationQueryDto } from '../common/pagination';

export class InferenceParametersDto {
  /** Sampling temperature; the N-ATLaS model card recommends 0.1. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsInt()
  @Min(16)
  @Max(2048)
  maxTokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.05)
  @Max(1)
  topP?: number;

  /** The N-ATLaS model card recommends 1.12. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(2)
  repetitionPenalty?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  seed?: number;

  /** Overrides the default system prompt. Send an empty string for no system prompt. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  systemPrompt?: string;
}

export class CreateRunDto {
  @IsUUID()
  projectId: string;

  /** Benchmark suite id. */
  @IsUUID()
  suiteId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(SUPPORTED_LANGUAGES, { each: true })
  languages: string[];

  /** Restrict to these categories. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(BENCHMARK_CATEGORIES, { each: true })
  categories?: string[];

  /** Run only these cases (ids from GET /benchmarks/:id/cases). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  caseIds?: string[];

  /** Only include cases whose content has been verified by a reviewer. */
  @IsOptional()
  @IsBoolean()
  onlyVerified?: boolean;

  /** Defaults to the system N-ATLaS configuration. */
  @IsOptional()
  @IsUUID()
  modelConfigurationId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InferenceParametersDto)
  parameters?: InferenceParametersDto;
}

export class ListRunsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsIn(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsUUID()
  suiteId?: string;
}

export class ListResultsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  language?: string;

  @IsOptional()
  @IsIn(VERDICTS)
  verdict?: string;

  @IsOptional()
  @IsIn(BENCHMARK_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ReviewResultDto {
  @IsIn(['PASSED', 'FAILED'])
  decision: 'PASSED' | 'FAILED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
