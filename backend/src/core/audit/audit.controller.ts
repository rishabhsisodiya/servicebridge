import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser, ClientInfo } from '../../auth/auth.types';
import { Client, CurrentUser, RequirePermissions, RequireRecentAuth } from '../../auth/decorators';
import type { Permission } from '../../auth/permissions';
import { AuditService } from './audit.service';
import { AuditLogQueryDto, UpdateRetentionDto } from './dto';

const AUDIT_EDIT: Permission = 'audit.edit';

/** Read side of the audit trail. The write side is AuditService.record. */
@Controller('audit-log')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  search(@Query() query: AuditLogQueryDto) {
    return this.audit.search({
      action: query.action,
      entityType: query.entityType,
      actorId: query.actorId,
      partnerKeyId: query.partnerKeyId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      search: query.search?.trim() || undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get('retention')
  @RequirePermissions('audit.read')
  async retention() {
    return { retentionDays: await this.audit.retentionDays() };
  }

  @Patch('retention')
  @RequirePermissions(AUDIT_EDIT)
  @RequireRecentAuth()
  async updateRetention(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateRetentionDto,
    @Client() client: ClientInfo,
  ) {
    const retentionDays = await this.audit.updateRetentionDays(
      body.retentionDays,
      { id: user.id, name: user.name },
      client,
    );
    return { retentionDays };
  }

  @Post('purge')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(AUDIT_EDIT)
  @RequireRecentAuth()
  async purge(@CurrentUser() user: AuthUser, @Client() client: ClientInfo) {
    const retentionDays = await this.audit.retentionDays();
    const { deleted } = await this.audit.purgeOlderThan(
      retentionDays,
      { id: user.id, name: user.name },
      client,
    );
    return { deleted, retentionDays };
  }
}
