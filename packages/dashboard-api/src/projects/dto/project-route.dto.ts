import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const JID_PATTERN = /^[^@\s]+@(s\.whatsapp\.net|g\.us)$/i;

export class CreateProjectRouteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(JID_PATTERN, { message: 'targetJid must be a WhatsApp contact or group JID' })
  targetJid!: string;
}

export class UpdateProjectRouteDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(JID_PATTERN, { message: 'targetJid must be a WhatsApp contact or group JID' })
  targetJid?: string;
}
