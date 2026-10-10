import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../common/auth-context';
import { Auth } from '../common/decorators';
import { CreateProjectDto, ListProjectsQueryDto, UpdateProjectDto } from './projects.dto';
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a project representing an AI application to evaluate.' })
  create(@Auth() auth: AuthContext, @Body() dto: CreateProjectDto) {
    return this.projects.create(auth, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List your projects with their latest evaluation run.' })
  list(@Auth() auth: AuthContext, @Query() query: ListProjectsQueryDto) {
    return this.projects.list(auth, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Project details, recent runs and evaluation summary.' })
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(auth, id);
  }

  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(auth, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archive a project. Evaluation history is preserved; project API keys are revoked.' })
  archive(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.archive(auth, id);
  }
}
