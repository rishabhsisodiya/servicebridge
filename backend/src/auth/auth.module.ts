import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../core/config/app-config.service';
import { RolesController } from '../roles/roles.controller';
import { RolesService } from '../roles/roles.service';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OriginGuard } from './origin.guard';
import { SessionsService } from './sessions.service';
import { UserTokensService } from './user-tokens.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { algorithm: 'HS256', expiresIn: config.get('ACCESS_TOKEN_TTL_SECONDS') },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController, UsersController, RolesController],
  providers: [
    AuthService,
    SessionsService,
    UserTokensService,
    UsersService,
    RolesService,
    // Order matters: the origin check runs before authentication.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [UsersService, SessionsService],
})
export class AuthModule {}
