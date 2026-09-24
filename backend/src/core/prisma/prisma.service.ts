import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connects lazily on the first query, so the API can boot (and report "not
 * ready") while the database is still starting instead of crash-looping.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
