import { BillingUnit, TicketPriority } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

class Versioned {
  @Type(() => Number)
  @IsInt()
  version: number;
}

export class UpdateLabelDto extends Versioned {
  @IsString()
  @MinLength(2, { message: 'Enter a label.' })
  @MaxLength(40)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class CreateServiceTypeDto {
  @IsString()
  @MinLength(2, { message: 'Enter a name.' })
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsEnum(TicketPriority, { message: 'Choose a priority.' })
  defaultPriority: TicketPriority;

  @IsBoolean()
  requiresEquipment: boolean;
}

export class UpdateServiceTypeDto extends Versioned {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Enter a name.' })
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsEnum(TicketPriority, { message: 'Choose a priority.' })
  defaultPriority?: TicketPriority;

  @IsOptional()
  @IsBoolean()
  requiresEquipment?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

class WindowDto {
  @IsInt()
  day: number;

  @IsString()
  open: string;

  @IsString()
  close: string;
}

class HolidayDto {
  @IsString()
  date: string;

  @IsString()
  name: string;
}

export class CalendarDto {
  @IsString()
  @MinLength(2, { message: 'Enter a name.' })
  @MaxLength(60)
  name: string;

  @IsBoolean()
  alwaysOpen: boolean;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WindowDto)
  hours: WindowDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => HolidayDto)
  holidays: HolidayDto[];
}

export class UpdateCalendarDto extends CalendarDto {
  @Type(() => Number)
  @IsInt()
  version: number;
}

/** 15 minutes to 60 days. */
const MAX_SLA_MINUTES = 60 * 24 * 60;

export class UpdateSlaPolicyDto extends Versioned {
  @IsInt({ message: 'Use whole minutes.' })
  @Min(15, { message: 'Use at least 15 minutes.' })
  @Max(MAX_SLA_MINUTES, { message: 'Use at most 60 days.' })
  responseMinutes: number;

  @IsInt({ message: 'Use whole minutes.' })
  @Min(15, { message: 'Use at least 15 minutes.' })
  @Max(MAX_SLA_MINUTES, { message: 'Use at most 60 days.' })
  resolutionMinutes: number;

  @IsString()
  calendarId: string;
}

export class BillingRateDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,29}$/, {
    message: 'Use capital letters, digits and _ (e.g. VISIT).',
  })
  code: string;

  @IsString()
  @MinLength(2, { message: 'Enter a name.' })
  @MaxLength(60)
  name: string;

  @IsEnum(BillingUnit, { message: 'Choose a unit.' })
  unit: BillingUnit;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter an amount with up to 2 decimals.' })
  @Min(0, { message: 'The amount cannot be negative.' })
  @Max(10_000_000)
  amount: number;

  /** null clears it. */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(140)
  erpItemCode?: string | null;
}

export class UpdateBillingRateDto extends BillingRateDto {
  @Type(() => Number)
  @IsInt()
  version: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class PriceListsDto {
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(140)
  sparesPriceList: string | null;

  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(140)
  amcPriceList: string | null;
}

export class RegionDto {
  @IsString()
  @MinLength(2, { message: 'Enter a name.' })
  @MaxLength(60)
  name: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  areaManagerId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500, { message: 'Use at most 500 pincode prefixes per region.' })
  @IsString({ each: true })
  pincodePrefixes?: string[];
}

export class UpdateRegionDto extends RegionDto {
  @Type(() => Number)
  @IsInt()
  version: number;
}

export class ResolvePincodeQuery {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Enter a 6-digit pincode.' })
  pincode: string;
}

export class SkillDto {
  @IsString()
  @MinLength(2, { message: 'Enter a name.' })
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  equipmentModels: string[];

  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  userIds: string[];
}

export class UpdateSkillDto extends SkillDto {
  @Type(() => Number)
  @IsInt()
  version: number;
}
