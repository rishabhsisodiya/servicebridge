import { Module } from '@nestjs/common';
import { ErpConnectionsController } from './connections/erp-connections.controller';
import { ErpConnectionsService } from './connections/erp-connections.service';
import { ConnectionRecovery } from './connection-recovery';
import { ErpRequestLogService } from './request-log.service';

@Module({
  controllers: [ErpConnectionsController],
  providers: [ErpConnectionsService, ErpRequestLogService, ConnectionRecovery],
  exports: [ErpConnectionsService, ErpRequestLogService],
})
export class ErpModule {}
