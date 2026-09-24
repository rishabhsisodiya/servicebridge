import { Module } from '@nestjs/common';
import { ConnectionRecovery } from './connection-recovery';
import { ErpConnectionsController } from './connections/erp-connections.controller';
import { ErpConnectionsService } from './connections/erp-connections.service';
import { ErpRequestLogService } from './request-log.service';
import { ErpSyncService } from './sync/erp-sync.service';
import {
  ErpWebhookAdminController,
  ErpWebhookReceiverController,
} from './sync/erp-webhooks.controller';
import { ErpWebhooksService } from './sync/erp-webhooks.service';

@Module({
  controllers: [ErpConnectionsController, ErpWebhookReceiverController, ErpWebhookAdminController],
  providers: [
    ErpConnectionsService,
    ErpRequestLogService,
    ConnectionRecovery,
    ErpSyncService,
    ErpWebhooksService,
  ],
  exports: [ErpConnectionsService, ErpRequestLogService, ErpSyncService],
})
export class ErpModule {}
