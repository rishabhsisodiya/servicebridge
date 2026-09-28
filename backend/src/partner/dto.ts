import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TicketPriority } from '@prisma/client';

/** Body for POST /partner/v1/tickets. Partners know ERP names, not our ids. */
export class PartnerCreateTicketDto {
  /** Our customer id, when the partner knows it. */
  @IsOptional()
  @IsString()
  customerId?: string;

  /** ERP customer name (preferred) — matched against erpName, then name. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerErpName?: string;

  @IsOptional()
  @IsString()
  equipmentId?: string;

  /** Machine serial number (preferred). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  equipmentSerial?: string;

  @IsOptional()
  @IsString()
  serviceTypeId?: string;

  /** Service type name, e.g. "Breakdown". Matched case-insensitively. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  serviceTypeName?: string;

  @IsOptional()
  @IsEnum(TicketPriority, { message: 'Choose a priority.' })
  priority?: TicketPriority;

  @Type(() => String)
  @IsString()
  @MinLength(5, { message: 'Describe the problem in a few words (at least 5 characters).' })
  @MaxLength(140, { message: 'Keep the summary under 140 characters; add detail below.' })
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactMobile?: string;

  /**
   * The partner's own reference for this ticket. Unique per API key: a repeat
   * POST with the same value returns the existing ticket instead of creating
   * a duplicate.
   */
  @IsString()
  @MaxLength(100)
  externalRef!: string;

  /** Set after the caller has seen the open tickets on the same machine. */
  @IsOptional()
  @IsBoolean()
  acknowledgeDuplicates?: boolean;
}

export class CreatePartnerKeyDto {
  @IsString()
  @MinLength(2, { message: 'Give the key a name.' })
  @MaxLength(100)
  name!: string;

  /** Permission names granted to the key — a subset of the creator's own. */
  @IsArray()
  @IsString({ each: true })
  scopes!: string[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class RevokePartnerKeyDto {
  @IsIn(['revoke'] as const, { message: 'Confirm revocation.' })
  confirm!: 'revoke';
}
