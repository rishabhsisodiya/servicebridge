import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import {
  ActionDto,
  CreateTicketDto,
  DuplicatesQuery,
  ListTicketsQuery,
  NoteDto,
  UpdateTicketDto,
} from './dto';
import {
  MAX_FILE_BYTES,
  TicketAttachmentsService,
  type UploadedFileLike,
} from './ticket-attachments.service';
import { TicketStatsService } from './ticket-stats.service';
import { TicketsService } from './tickets.service';

@Controller('tickets')
@RequirePermissions('tickets.view')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly attachments: TicketAttachmentsService,
    private readonly stats: TicketStatsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListTicketsQuery) {
    return this.tickets.list(user, query);
  }

  @Get('lookups')
  lookups() {
    return this.tickets.lookups();
  }

  /** Figures for the role home pages. */
  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.stats.summary(user);
  }

  @Get('duplicates')
  duplicates(@CurrentUser() user: AuthUser, @Query() query: DuplicatesQuery) {
    return this.tickets.duplicates(user, query.equipmentId);
  }

  @Post()
  @RequirePermissions('tickets.create')
  create(@CurrentUser() user: AuthUser, @Body() body: CreateTicketDto) {
    return this.tickets.create(user, body);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tickets.detail(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: UpdateTicketDto) {
    return this.tickets.update(user, id, body);
  }

  /** Every stage change goes through here; the workflow decides who may do what. */
  @Post(':id/actions')
  act(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: ActionDto) {
    return this.tickets.act(user, id, body);
  }

  @Post(':id/notes')
  addNote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: NoteDto) {
    return this.tickets.addNote(user, id, body.note);
  }

  @Get(':id/engineers')
  @RequirePermissions('tickets.assign')
  suggestions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tickets.suggestions(user, id);
  }

  /** The ticket's pending SLA timers (BullMQ delayed jobs). */
  @Get(':id/scheduled')
  async scheduled(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tickets.timersFor(await this.tickets.visibleId(user, id));
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    return this.attachments.upload(user, id, file);
  }

  @Get(':id/attachments/:attachmentId')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { attachment, stream } = await this.attachments.open(user, id, attachmentId);
    // Photos open in the browser; PDFs download. nosniff stops the browser guessing another type.
    const disposition = attachment.mimeType.startsWith('image/') ? 'inline' : 'attachment';
    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Length': String(attachment.sizeBytes),
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    });
    return new StreamableFile(stream);
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachments.remove(user, id, attachmentId);
  }
}
