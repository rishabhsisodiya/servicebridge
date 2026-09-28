import { TicketScope } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

class RoleBody {
  /** null clears it. */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(200, { message: 'Use at most 200 characters.' })
  description?: string | null;

  @IsOptional()
  @IsEnum(TicketScope, { message: 'Choose which tickets people with this role can see.' })
  ticketScope?: TicketScope;

  /** Permission names; unknown names are dropped and implied read permissions added. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  permissions?: string[];
}

export class CreateRoleDto extends RoleBody {
  @IsString()
  @MinLength(2, { message: 'Enter a role name.' })
  @MaxLength(50, { message: 'Use at most 50 characters.' })
  name: string;

  /** Start from another role's permissions and ticket scope; the other fields override them. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  copyFromId?: string;
}

export class UpdateRoleDto extends RoleBody {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Enter a role name.' })
  @MaxLength(50, { message: 'Use at most 50 characters.' })
  name?: string;

  /** The version the editor loaded; a stale version is rejected. */
  @IsInt()
  version: number;
}

export class DeleteRoleQuery {
  @Type(() => Number)
  @IsInt()
  version: number;
}
