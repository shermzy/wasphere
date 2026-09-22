import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  MaxLength,
} from 'class-validator';
import { CampaignStatus } from '.prisma/client';

export const MAX_CAMPAIGN_RECIPIENTS = 500;
export const MAX_CAMPAIGN_NAME_LENGTH = 120;
export const MAX_CAMPAIGN_MESSAGE_LENGTH = 4096;

export class CreateCampaignDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CAMPAIGN_NAME_LENGTH)
  name!: string;

  @IsString()
  @MaxLength(200)
  providerSessionId!: string;

  @IsString()
  @MaxLength(MAX_CAMPAIGN_MESSAGE_LENGTH)
  message!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CAMPAIGN_RECIPIENTS)
  @IsUUID('4', { each: true })
  contactIds!: string[];
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CAMPAIGN_NAME_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerSessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CAMPAIGN_MESSAGE_LENGTH)
  message?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CAMPAIGN_RECIPIENTS)
  @IsUUID('4', { each: true })
  contactIds?: string[];
}

export class ScheduleCampaignDto {
  @IsDateString()
  scheduledAt!: string;
}

export class LaunchCampaignDto {
  @IsBoolean()
  confirm!: boolean;
}

export class ListCampaignsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;
}
