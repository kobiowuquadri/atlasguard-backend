import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Module({
  imports: [ApiKeysModule],
  controllers: [AuthController],
  providers: [AuthService, SessionService, AuthGuard],
  exports: [SessionService, AuthGuard],
})
export class AuthModule {}
