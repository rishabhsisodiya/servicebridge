import { UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class ListUsersQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  roleId?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  regionId?: string;

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

export class InviteUserDto {
  @IsString()
  @MinLength(2, { message: 'Enter their full name.' })
  @MaxLength(80)
  name: string;

  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email: string;

  @IsString({ message: 'Choose a role.' })
  @MinLength(1, { message: 'Choose a role.' })
  @MaxLength(40)
  roleId: string;

  @IsOptional()
  @IsString()
  regionId?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Enter their full name.' })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString({ message: 'Choose a role.' })
  @MinLength(1, { message: 'Choose a role.' })
  @MaxLength(40)
  roleId?: string;

  /** null removes the region. */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  regionId?: string | null;

  /** The version the editor loaded; a stale version is rejected. */
  @IsInt()
  version: number;
}
