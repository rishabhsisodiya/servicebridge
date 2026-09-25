import { TicketChannel, TicketPriority, TicketStage } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ACTIONS, type TicketAction } from './workflow';

export const QUICK_FILTERS = [
  'open',
  'mine',
  'sla-risk',
  'unassigned',
  'awaiting-verification',
  'chargeable',
  'closed',
  'all',
] as const;
export type QuickFilter = (typeof QUICK_FILTERS)[number];

export const SORTS = ['newest', 'oldest', 'due', 'priority'] as const;
export type TicketSort = (typeof SORTS)[number];

export class ListTicketsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(QUICK_FILTERS)
  quick: QuickFilter = 'open';

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsEnum(TicketStage)
  stage?: TicketStage;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  equipmentId?: string;

  @IsOptional()
  @IsIn(SORTS)
  sort: TicketSort = 'newest';

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

export class CreateTicketDto {
  @IsString()
  customerId: string;

  @IsOptional()
  @IsString()
  siteId?: string;

  @IsOptional()
  @IsString()
  equipmentId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsString({ message: 'Choose a service type.' })
  serviceTypeId: string;

  /** Defaults to the service type's priority. */
  @IsOptional()
  @IsEnum(TicketPriority, { message: 'Choose a priority.' })
  priority?: TicketPriority;

  @IsEnum(TicketChannel, { message: 'Choose how the request came in.' })
  channel: TicketChannel;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5, { message: 'Describe the problem in a few words (at least 5 characters).' })
  @MaxLength(140, { message: 'Keep the summary under 140 characters; add detail below.' })
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  /** Set after the user has seen the open tickets on the same machine. */
  @IsOptional()
  @IsBoolean()
  acknowledgeDuplicates?: boolean;
}

export class ActionDto {
  @IsIn(Object.keys(ACTIONS))
  action: TicketAction;

  @Type(() => Number)
  @IsInt()
  version: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /** For "assign". */
  @IsOptional()
  @IsString()
  engineerId?: string;
}

export class UpdateTicketDto {
  @Type(() => Number)
  @IsInt()
  version: number;

  @IsOptional()
  @IsEnum(TicketPriority, { message: 'Choose a priority.' })
  priority?: TicketPriority;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5, { message: 'Describe the problem in a few words (at least 5 characters).' })
  @MaxLength(140)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class NoteDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'Write a note first.' })
  @MaxLength(2000)
  note: string;
}

export class DuplicatesQuery {
  @IsString()
  equipmentId: string;
}
