import { Module } from '@nestjs/common';
import { CsatController } from './csat.controller';
import { CsatService } from './csat.service';
import { TicketFeedbackController } from './ticket-feedback.controller';

@Module({
  controllers: [CsatController, TicketFeedbackController],
  providers: [CsatService],
  exports: [CsatService],
})
export class FeedbackModule {}
