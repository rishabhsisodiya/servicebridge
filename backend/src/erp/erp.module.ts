import { Module } from '@nestjs/common';
import { ErpConnectionsController } from './connections/erp-connections.controller';
import { ErpConnectionsService } from './connections/erp-connections.service';
import { ErpRequestLogService } from './request-log.service';

@Module({
  controllers: [ErpConnectionsController],
  providers: [ErpConnectionsService, ErpRequestLogService],
  exports: [ErpConnectionsService, ErpRequestLogService],
})
export class ErpModule {}
