import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions, RequireRecentAuth } from '../auth/decorators';
import { ConfirmImportDto } from './dto';
import { IMPORTS_EDIT, ImportService, type UploadedFileLike } from './import.service';

const MAX_CSV_BYTES = 5 * 1024 * 1024;

/**
 * Bulk CSV import of customers and machines. Two steps: validate (parses and
 * returns a preview, writing nothing) then confirm (applies the preview's
 * dispositions, or per-row overrides). The validation is held server-side for
 * 30 minutes so the preview can't be tampered with between steps.
 */
@Controller('imports')
@RequirePermissions(IMPORTS_EDIT)
export class ImportsController {
  constructor(private readonly imports: ImportService) {}

  @Post(':entity/validate')
  @HttpCode(HttpStatus.OK)
  @RequireRecentAuth()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CSV_BYTES, files: 1 } }))
  validate(
    @Param('entity') entity: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    return this.imports.validate(this.imports.assertEntity(entity), file);
  }

  @Post(':entity/confirm')
  @HttpCode(HttpStatus.OK)
  @RequireRecentAuth()
  confirm(
    @Param('entity') entity: string,
    @CurrentUser() user: AuthUser,
    @Body() body: ConfirmImportDto,
    @Client() client: ClientInfo,
  ) {
    return this.imports.confirm(this.imports.assertEntity(entity), body, user, client);
  }
}
