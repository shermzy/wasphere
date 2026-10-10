import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsISO8601, IsNumber, Min, Max, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendEventLocationDto {
  @ApiProperty({ description: 'Latitude in decimal degrees (-90 to 90)', example: 1.2834 })
  @IsNumber() @Min(-90) @Max(90) latitude: number;

  @ApiProperty({ description: 'Longitude in decimal degrees (-180 to 180)', example: 103.8607 })
  @IsNumber() @Min(-180) @Max(180) longitude: number;

  @ApiPropertyOptional({ description: 'Location name (max 255 characters)', example: 'Marina Bay Sands' })
  @IsOptional() @IsString() @MaxLength(255) name?: string;

  @ApiPropertyOptional({ description: 'Street address (max 512 characters)', example: '10 Bayfront Ave, Singapore' })
  @IsOptional() @IsString() @MaxLength(512) address?: string;
}

export class SendEventDto {
  @ApiProperty({ description: 'Recipient phone number with country code (e.g. 923001234567) or full WhatsApp JID (e.g. 923001234567@s.whatsapp.net). Both formats are accepted.', example: '923001234567' })
  @IsString() @IsNotEmpty() @MaxLength(40) to: string;

  @ApiProperty({ description: 'Event name (max 255 characters)', example: 'Team escape room' })
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;

  @ApiPropertyOptional({ description: 'Event description (max 2048 characters)', example: 'Meet at the lobby 10 minutes early.' })
  @IsOptional() @IsString() @MaxLength(2048) description?: string;

  @ApiProperty({ description: 'Start time, ISO 8601 with an offset', example: '2026-10-12T19:00:00+08:00' })
  @IsISO8601({ strict: true }) startTime: string;

  @ApiPropertyOptional({ description: 'End time, ISO 8601 with an offset', example: '2026-10-12T20:00:00+08:00' })
  @IsOptional() @IsISO8601({ strict: true }) endTime?: string;

  @ApiPropertyOptional({ description: 'Event location shown on the card' })
  @IsOptional() @ValidateNested() @Type(() => SendEventLocationDto) location?: SendEventLocationDto;

  @ApiPropertyOptional({ description: 'Whether guests may bring extra guests', example: false })
  @IsOptional() @IsBoolean() extraGuestsAllowed?: boolean;
}
