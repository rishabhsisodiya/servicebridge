import { Module } from '@nestjs/common';
import { CsatController } from './csat.controller';
import { CsatService } from './csat.service';
import { TicketFeedbackController, TicketSurveyLinkController } from './ticket-feedback.controller';

@Module({
  controllers: [CsatController, TicketFeedbackController, TicketSurveyLinkController],
  providers: [CsatService],
  exports: [CsatService],
})
export class FeedbackModule {}
