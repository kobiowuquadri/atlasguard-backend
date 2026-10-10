import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EVALUATOR_VERSION } from '@atlasguard/evaluator';
import { AppException } from '../common/app-exception';
import { Public } from '../common/decorators';
import { PrismaService } from '../database/prisma.service';

export const API_VERSION = '0.1.0';

@ApiTags('System')
@Public()
@Controller()
export class SystemController {
  private readonly startedAt = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness: the process is up.' })
  health() {
    return {
      status: 'ok',
      service: 'atlasguard-api',
      version: API_VERSION,
      evaluatorVersion: EVALUATOR_VERSION,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: the database is reachable.' })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new AppException('INTERNAL_ERROR', 'Database is not reachable.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ready', database: 'ok' };
  }
}
