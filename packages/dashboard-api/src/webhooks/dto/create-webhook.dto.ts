import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateWebhookDto {
  @ApiProperty({ example: 'Production alerts', maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;

  @ApiProperty({ example: 'https://example.com/webhook' })
  @IsUrl({ require_tld: false }) // allow localhost in dev
  url!: string;

  @ApiProperty({
    example: ['message.sent', 'session.connected'],
    description: 'Event types to subscribe to. Use ["*"] for all events.',
  })
  @IsArray()
  @IsString({ each: true })
  events!: string[];

  @ApiPropertyOptional({ example: 3, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  retryMax?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Optional HMAC signing secret. It is trimmed, shown once, and never returned by list endpoints.',
    minLength: 32,
    maxLength: 256,
    writeOnly: true,
  })
  @IsString()
  @Matches(/^\P{Cc}*$/u, { message: 'signingSecret must not contain control characters' })
  @IsOptional()
  signingSecret?: string;
}
