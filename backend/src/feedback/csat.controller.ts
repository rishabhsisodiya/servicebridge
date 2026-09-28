import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Public } from '../auth/decorators';
import { RateLimitService } from '../core/rate-limit/rate-limit.service';
import { hashToken } from '../core/security/tokens';
import { CsatService } from './csat.service';

class AnswerDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

/**
 * The public feedback page. No sign-in: the token is the credential, and both
 * routes are rate-limited by IP so a link can't be brute-forced or spammed.
 */
@Controller('public/csat')
export class CsatController {
  constructor(
    private readonly csat: CsatService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get(':token')
  @Public()
  async describe(@Param('token') token: string) {
    await this.rateLimit.enforce(`csat:describe:${hashToken(token)}`, 60, 60);
    return this.csat.describe(token);
  }

  @Post(':token')
  @Public()
  @HttpCode(HttpStatus.OK)
  async answer(@Param('token') token: string, @Body() body: AnswerDto) {
    await this.rateLimit.enforce(`csat:answer:${hashToken(token)}`, 10, 60 * 60);
    return this.csat.answer(token, body.rating, body.comment ?? null);
  }
}
