import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions, RequireRecentAuth } from '../auth/decorators';
import { AuditService } from '../core/audit/audit.service';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { AppSettingsService } from '../demo/app-settings.service';
import { assertVersion } from '../service-rules/common';
import { EmailService } from './email.service';

class UpdateEmailSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fromName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fromAddress?: string;
}

class TestEmailDto {
  @IsString()
  @MaxLength(255)
  to!: string;
}

class UpdateEmailTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsString()
  bodyText?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Optimistic concurrency: must match the template's current version. */
  @IsNumber()
  version!: number;
}

/**
 * Email (SMTP) settings, the template library and the delivery log. Lives in
 * the notifications module (not the demo controller) so it can use the
 * EmailService without a module cycle.
 */
@Controller()
export class EmailSettingsController {
  constructor(
    private readonly settings: AppSettingsService,
    private readonly email: EmailService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** SMTP settings. The password is never returned; see hasPassword. */
  @Get('settings/app/email')
  @RequirePermissions('company.read')
  emailSettings() {
    return this.settings.email();
  }

  @Patch('settings/app/email')
  @RequirePermissions('company.edit')
  @RequireRecentAuth()
  updateEmailSettings(
    @CurrentUser() actor: AuthUser,
    @Body() body: UpdateEmailSettingsDto,
    @Client() client: ClientInfo,
  ) {
    return this.settings.updateEmailSettings(actor, body, client);
  }

  @Post('settings/app/email/test')
  @RequirePermissions('company.edit')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.OK)
  async sendTestEmail(
    @CurrentUser() actor: AuthUser,
    @Body() body: TestEmailDto,
    @Client() client: ClientInfo,
  ) {
    await this.email.sendTestEmail(body.to.trim());
    await this.audit.record({
      actorId: actor.id,
      action: 'settings.email_tested',
      entityType: 'app_setting',
      entityId: 'email',
      summary: `${actor.name} sent a test email to ${body.to.trim()}`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return { sent: true };
  }

  /** The editable template library. */
  @Get('settings/app/email/templates')
  @RequirePermissions('company.read')
  templates() {
    return this.prisma.emailTemplate.findMany({ orderBy: { key: 'asc' } });
  }

  @Patch('settings/app/email/templates/:key')
  @RequirePermissions('company.edit')
  async updateTemplate(
    @CurrentUser() actor: AuthUser,
    @Param('key') key: string,
    @Body() body: UpdateEmailTemplateDto,
    @Client() client: ClientInfo,
  ) {
    const template = await this.prisma.emailTemplate.findUnique({ where: { key } });
    if (!template) {
      throw new AppException(
        'EMAIL_TEMPLATE_NOT_FOUND',
        'That email template no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    assertVersion(template.version, body.version, 'template');
    const updated = await this.prisma.emailTemplate.update({
      where: { key },
      data: {
        subject: body.subject ?? template.subject,
        bodyHtml: body.bodyHtml ?? template.bodyHtml,
        bodyText: body.bodyText ?? template.bodyText,
        enabled: body.enabled ?? template.enabled,
        version: { increment: 1 },
      },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'settings.email_template_updated',
      entityType: 'email_template',
      entityId: key,
      summary: `${actor.name} updated the "${template.name}" email template`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return updated;
  }

  /** Recent deliveries, newest first, for the admin to inspect. */
  @Get('settings/app/email/log')
  @RequirePermissions('company.read')
  emailLog() {
    return this.prisma.emailLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        to: true,
        templateKey: true,
        subject: true,
        status: true,
        error: true,
        attempts: true,
        sentAt: true,
        createdAt: true,
        ticket: { select: { id: true, number: true } },
      },
    });
  }
}
