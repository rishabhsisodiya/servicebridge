import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Magic-link request. The response is always { ok: true }, even when the email is unknown. */
export class RequestPortalLinkDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email!: string;
}

/** Raise a ticket through the portal. Customer, contact and channel are fixed server-side. */
export class PortalCreateTicketDto {
  @IsOptional()
  @IsString()
  equipmentId?: string;

  @IsOptional()
  @IsString()
  serviceTypeId?: string;

  @IsString()
  @MinLength(5, { message: 'Describe the problem in a few words (at least 5 characters).' })
  @MaxLength(140)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

/** Paginated portal ticket list. */
export class PortalTicketListDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

/** Approve a sent quotation, optionally supplying the customer's PO number. */
export class PortalApproveQuotationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Enter the PO number.' })
  @MaxLength(80)
  poNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  poDate?: string;
}

/** Reject a sent quotation. */
export class PortalRejectQuotationDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

/** Filter the portal quotation list. */
export class PortalQuotationListDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ticketNumber?: string;
}
