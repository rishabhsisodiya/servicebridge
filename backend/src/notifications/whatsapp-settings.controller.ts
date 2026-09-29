import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsNumber, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions, RequireRecentAuth } from '../auth/decorators';
import { AuditService } from '../core/audit/audit.service';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { AppSettingsService } from '../demo/app-settings.service';
import { assertVersion } from '../service-rules/common';
import { WhatsAppService } from './whatsapp.service';

class UpdateWhatsAppSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  phoneNumberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  businessAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  displayPhoneNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  verifyToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  appSecret?: string;
}

class TestWhatsAppDto {
  @IsString()
  @MaxLength(32)
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  templateKey?: string;
}

class UpdateWhatsAppTemplateDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Optimistic concurrency: must match the template's current version. */
  @IsNumber()
  version!: number;
}

class UpdateChannelsDto {
  @IsObject()
  channels!: Record<string, { email?: boolean; whatsapp?: boolean }>;
}

/**
 * WhatsApp (Meta Cloud API) settings, the read-only Meta-approved template
 * list, the per-template channel toggles and the delivery log. Templates have
 * no text editor: business-initiated WhatsApp messages must use templates
 * approved in the Meta dashboard, so admins only toggle `enabled`.
 */
@Controller()
export class WhatsAppSettingsController {
  constructor(
    private readonly settings: AppSettingsService,
    private readonly whatsapp: WhatsAppService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** WhatsApp settings. Secrets are never returned; see hasAccessToken/hasAppSecret. */
  @Get('settings/whatsapp')
  @RequirePermissions('company.read')
  async whatsappSettings() {
    return { ...(await this.settings.whatsapp()), webhookUrl: this.whatsapp.webhookUrl() };
  }

  @Patch('settings/whatsapp')
  @RequirePermissions('company.edit')
  @RequireRecentAuth()
  updateWhatsAppSettings(
    @CurrentUser() actor: AuthUser,
    @Body() body: UpdateWhatsAppSettingsDto,
    @Client() client: ClientInfo,
  ) {
    return this.settings.updateWhatsAppSettings(actor, body, client);
  }

  @Post('settings/whatsapp/test')
  @RequirePermissions('company.edit')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.OK)
  async sendTestMessage(
    @CurrentUser() actor: AuthUser,
    @Body() body: TestWhatsAppDto,
    @Client() client: ClientInfo,
  ) {
    const logId = await this.whatsapp.sendTestMessage(body.to.trim(), body.templateKey?.trim() || undefined);
    await this.audit.record({
      actorId: actor.id,
      action: 'settings.whatsapp_tested',
      entityType: 'app_setting',
      entityId: 'whatsapp',
      summary: `${actor.name} sent a test WhatsApp message to ${body.to.trim()}`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return { sent: true, logId };
  }

  /** The Meta-approved template library (read-only wording, admin toggles only). */
  @Get('settings/whatsapp/templates')
  @RequirePermissions('company.read')
  templates() {
    return this.prisma.whatsAppTemplate.findMany({ orderBy: { key: 'asc' } });
  }

  @Patch('settings/whatsapp/templates/:key')
  @RequirePermissions('company.edit')
  async updateTemplate(
    @CurrentUser() actor: AuthUser,
    @Param('key') key: string,
    @Body() body: UpdateWhatsAppTemplateDto,
    @Client() client: ClientInfo,
  ) {
    const template = await this.prisma.whatsAppTemplate.findUnique({ where: { key } });
    if (!template) {
      throw new AppException(
        'WHATSAPP_TEMPLATE_NOT_FOUND',
        'That WhatsApp template no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    assertVersion(template.version, body.version, 'template');
    const updated = await this.prisma.whatsAppTemplate.update({
      where: { key },
      data: { enabled: body.enabled ?? template.enabled, version: { increment: 1 } },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'settings.whatsapp_template_updated',
      entityType: 'whatsapp_template',
      entityId: key,
      summary: `${actor.name} switched the "${template.name}" WhatsApp template ${updated.enabled ? 'on' : 'off'}`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return updated;
  }

  /** Per-template channel toggles: which template goes out over email, WhatsApp, both or neither. */
  @Get('settings/whatsapp/channels')
  @RequirePermissions('company.read')
  channels() {
    return this.settings.notificationChannels();
  }

  @Patch('settings/whatsapp/channels')
  @RequirePermissions('company.edit')
  updateChannels(
    @CurrentUser() actor: AuthUser,
    @Body() body: UpdateChannelsDto,
    @Client() client: ClientInfo,
  ) {
    return this.settings.updateNotificationChannels(actor, body, client);
  }

  /** Recent deliveries, newest first, for the admin to inspect. */
  @Get('settings/whatsapp/log')
  @RequirePermissions('company.read')
  whatsappLog() {
    return this.prisma.whatsAppLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        to: true,
        templateKey: true,
        providerMessageId: true,
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
