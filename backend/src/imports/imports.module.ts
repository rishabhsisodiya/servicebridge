import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportService } from './import.service';

/**
 * Session 15: bulk CSV import of customers and machines with a validation
 * preview.
 * NOTE: the integration pass must add ImportsModule to app.module.ts imports.
 */
@Module({
  controllers: [ImportsController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportsModule {}
