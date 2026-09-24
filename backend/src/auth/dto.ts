import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(1, { message: 'Enter your password.' })
  @MaxLength(128)
  password: string;
}

export class PasswordDto {
  @IsString()
  @MinLength(1, { message: 'Enter your password.' })
  @MaxLength(128)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Enter your current password.' })
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MaxLength(128)
  newPassword: string;
}

export class UpdateProfileDto {
  @IsString()
  @MinLength(2, { message: 'Enter your full name.' })
  @MaxLength(80)
  name: string;
}
