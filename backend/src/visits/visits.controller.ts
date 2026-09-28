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
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import type { UploadedFileLike } from '../tickets/ticket-attachments.service';
import {
  AddSpareDto,
  CreateVisitDto,
  RefuseSignatureDto,
  UpdateSpareDto,
  UpdateVisitDto,
} from './dto';
import {
  MAX_PHOTO_BYTES,
  MAX_SIGNATURE_BYTES,
  VisitsService,
} from './visits.service';

@Controller('visits')
@RequirePermissions('visits.read')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Post()
  @RequirePermissions('visits.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVisitDto) {
    return this.visits.create(user, dto);
  }

  /** Visits on one ticket, oldest first. Declared before ':id'. */
  @Get('ticket/:ticketId')
  listForTicket(@CurrentUser() user: AuthUser, @Param('ticketId') ticketId: string) {
    return this.visits.listForTicket(user, ticketId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.visits.get(user, id);
  }

  @Get(':id/photos/:photoId')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { photo, stream } = await this.visits.openPhoto(user, id, photoId);
    res.set({
      'Content-Type': photo.mimeType,
      'Content-Length': String(photo.sizeBytes),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(photo.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    });
    return new StreamableFile(stream);
  }

  @Get(':id/signature')
  async downloadSignature(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { signatureKey, stream } = await this.visits.openSignature(user, id);
    const ext = signatureKey.split('.').pop()?.toLowerCase();
    res.set({
      'Content-Type': ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png',
      'Content-Disposition': `inline; filename="signature-${id}.png"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    });
    return new StreamableFile(stream);
  }

  @Patch(':id')
  @RequirePermissions('visits.edit')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateVisitDto,
  ) {
    return this.visits.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('visits.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.visits.remove(user, id);
  }

  @Post(':id/submit')
  @RequirePermissions('visits.edit')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.visits.submit(user, id);
  }

  @Post(':id/spares')
  @RequirePermissions('visits.edit')
  addSpare(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddSpareDto,
  ) {
    return this.visits.addSpare(user, id, dto);
  }

  @Patch(':id/spares/:spareId')
  @RequirePermissions('visits.edit')
  updateSpare(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('spareId') spareId: string,
    @Body() dto: UpdateSpareDto,
  ) {
    return this.visits.updateSpare(user, id, spareId, dto);
  }

  @Delete(':id/spares/:spareId')
  @RequirePermissions('visits.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSpare(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('spareId') spareId: string,
  ) {
    await this.visits.removeSpare(user, id, spareId);
  }

  @Post(':id/photos')
  @RequirePermissions('visits.edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  addPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    return this.visits.addPhoto(user, id, file);
  }

  @Delete(':id/photos/:photoId')
  @RequirePermissions('visits.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ) {
    await this.visits.removePhoto(user, id, photoId);
  }

  @Post(':id/signature')
  @RequirePermissions('visits.edit')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_SIGNATURE_BYTES, files: 1 } }),
  )
  setSignature(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    return this.visits.setSignature(user, id, file);
  }

  @Post(':id/signature/refuse')
  @RequirePermissions('visits.edit')
  refuseSignature(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RefuseSignatureDto,
  ) {
    return this.visits.refuseSignature(user, id, dto);
  }
}
