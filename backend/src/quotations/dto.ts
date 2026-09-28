import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { QuotationStatus } from '@prisma/client';

/** A calendar date, YYYY-MM-DD. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateQuotationDto {
  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  /** Must be a future date; the offer lapses after it. */
  @IsString()
  @Matches(DATE_RE, { message: 'Use YYYY-MM-DD.' })
  validUntil!: string;

  /** Optional total-level discount, in percent. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notes?: string;
}

export class UpdateQuotationDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'Use YYYY-MM-DD.' })
  validUntil?: string;

  /** Null clears the discount. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notes?: string;

  /** Optimistic concurrency: must match the quotation's current version. */
  @IsInt()
  version!: number;
}

export class AddLineDto {
  @IsString()
  @IsNotEmpty()
  itemId!: string;

  /** Fractional quantities allowed (e.g. labour hours). */
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(999999)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(9999999999.99)
  rate!: number;
}

export class UpdateLineDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(999999)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(9999999999.99)
  rate!: number;

  /** Optimistic concurrency: must match the quotation's current version. */
  @IsInt()
  version!: number;
}

export class RecordPoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  poNumber!: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'Use YYYY-MM-DD.' })
  poDate?: string;

  /** Optimistic concurrency: must match the quotation's current version. */
  @IsInt()
  version!: number;
}

export class UpdateQuotationSettingsDto {
  @IsOptional()
  requirePoBeforeWork?: boolean;
}

/** Body for actions that only need optimistic concurrency. */
export class VersionDto {
  /** Must match the quotation's current version. */
  @IsInt()
  version!: number;
}

/** Query for the paginated global list: `GET /quotations`. */
export class ListQuotationsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(QuotationStatus)
  status?: QuotationStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}
