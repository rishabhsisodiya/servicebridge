import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { INVOICE_TRIGGERS, type InvoiceTrigger } from '../../demo/app-settings.service';

export class UpdateWritebackSettingsDto {
  @IsOptional()
  @IsArray()
  @IsIn(INVOICE_TRIGGERS, { each: true })
  invoiceTriggers?: InvoiceTrigger[];

  @IsOptional()
  @IsString()
  defaultWarehouseId?: string | null;

  @IsOptional()
  @IsBoolean()
  stockEntryAsDraft?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  invoiceTaxTemplate?: string | null;
}

export class CreateWarehouseDto {
  @IsString()
  @MaxLength(120)
  name!: string;
}

export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
