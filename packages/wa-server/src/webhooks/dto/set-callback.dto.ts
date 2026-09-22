import { IsUrl, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetCallbackDto {
  @ApiProperty({ description: 'URL to receive WhatsApp event webhooks (http or https, max 2048 characters)', example: 'http://localhost:3000/internal/audit' })
  @IsUrl({ protocols: ['http', 'https'], require_tld: false, require_protocol: true }) @MaxLength(2048) url: string;
}
