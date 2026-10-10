import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { Response } from 'express';
import type { AuthContext } from '../common/auth-context';
import { Auth, RawResponse, Roles, SessionOnly } from '../common/decorators';
import { PrismaService } from '../database/prisma.service';
import { API_VERSION } from '../system/system.controller';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SubmitFeedbackDto {
  /** Name or an agreed pseudonym. */
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  testerIdentifier: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  developerBackground?: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  testedFeatures: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  easeOfUseRating?: number;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mostUsefulFeature?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  problemsEncountered?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  suggestions?: string;

  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(4000)
  overallAssessment: string;

  /** Consent to use this feedback as competition evidence. */
  @IsBoolean()
  @Equals(true, { message: 'consent is required to submit feedback' })
  consentRecorded: boolean;
}

@ApiTags('Beta feedback')
@ApiCookieAuth()
@SessionOnly()
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit beta-testing feedback (stored with the tester’s consent).' })
  async submit(@Auth() auth: AuthContext, @Body() dto: SubmitFeedbackDto) {
    const feedback = await this.prisma.betaFeedback.create({
      data: { ...dto, userId: auth.user.id, projectVersion: API_VERSION },
    });
    return { id: feedback.id, createdAt: feedback.createdAt };
  }

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List all beta feedback (administrators).' })
  list() {
    return this.prisma.betaFeedback.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Get('export')
  @Roles('ADMIN')
  @RawResponse()
  @ApiOperation({ summary: 'Download all consented beta feedback as JSON for the evidence folder (administrators).' })
  async export(@Res() res: Response) {
    const feedback = await this.prisma.betaFeedback.findMany({ where: { consentRecorded: true }, orderBy: { createdAt: 'asc' } });
    res
      .status(200)
      .setHeader('Content-Type', 'application/json; charset=utf-8')
      .setHeader('Content-Disposition', 'attachment; filename="atlasguard-beta-feedback.json"')
      .send(`${JSON.stringify({ exportedAt: new Date().toISOString(), count: feedback.length, feedback }, null, 2)}\n`);
  }
}
