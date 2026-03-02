import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsInt,
  IsBoolean,
  IsArray,
  Min,
  Max,
} from 'class-validator';

export class QuestionnaireDto {
  // Section 1: Demographics & Consent
  @ApiPropertyOptional({ example: 35 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(150)
  age?: number;

  @ApiPropertyOptional({
    example: 'Male',
    enum: ['Male', 'Female', 'Non-binary/Other', 'Prefer not to say'],
  })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional({
    example: 'Secondary/High School',
    enum: [
      'Primary School',
      'Secondary/High School',
      'Trade/Vocational Training',
      'University/College Degree',
      'None',
    ],
  })
  @IsOptional()
  @IsString()
  education?: string;

  @ApiPropertyOptional({ example: 'Teacher' })
  @IsOptional()
  @IsString()
  occupation?: string;

  @ApiPropertyOptional({ example: 'Kibera' })
  @IsOptional()
  @IsString()
  residenceVillage?: string;

  @ApiPropertyOptional({ example: 'Nairobi' })
  @IsOptional()
  @IsString()
  residenceCounty?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  researchConsent: boolean;

  // Section 2: Medical & Dental History
  @ApiPropertyOptional({
    example: '6 – 12 months ago',
    enum: [
      'Less than 6 months ago',
      '6 – 12 months ago',
      '1 – 2 years ago',
      'More than 2 years ago',
      'Never',
    ],
  })
  @IsOptional()
  @IsString()
  lastDentalVisit?: string;

  @ApiPropertyOptional({ example: 'Penicillin' })
  @IsOptional()
  @IsString()
  drugAllergies?: string;

  @ApiPropertyOptional({ example: 'Metformin, Aspirin' })
  @IsOptional()
  @IsString()
  currentMedications?: string;

  @ApiPropertyOptional({
    example: ['Diabetes (Type 1 or 2)', 'Hypertension / Heart Disease'],
  })
  @IsOptional()
  @IsArray()
  medicalConditions?: string[];

  @ApiPropertyOptional({ example: ['Severe Gum Disease (Periodontitis)'] })
  @IsOptional()
  @IsArray()
  familyHistory?: string[];

  // Section 3: Current Dental Concerns
  @ApiPropertyOptional({
    example: 'Tooth Pain / Discomfort',
    enum: [
      'Routine Check-up / Cleaning',
      'Tooth Pain / Discomfort',
      'Broken / Chipped Tooth',
      'Bleeding Gums',
      'Aesthetic / Appearance Concern',
      'Other',
    ],
  })
  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @ApiPropertyOptional({ example: 7, minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  painLevel?: number;

  @ApiPropertyOptional({
    example: ['Sensitivity to Hot/Cold', 'Pain when chewing'],
  })
  @IsOptional()
  @IsArray()
  recentSymptoms?: string[];

  // Section 4: Oral Hygiene & Lifestyle
  @ApiPropertyOptional({
    example: 'Twice a day or more',
    enum: [
      'Twice a day or more',
      'Once a day',
      'Occasionally / Rarely',
      'Never',
    ],
  })
  @IsOptional()
  @IsString()
  brushingFrequency?: string;

  @ApiPropertyOptional({
    example: 'Daily',
    enum: ['Daily', 'Weekly', 'Rarely / Never'],
  })
  @IsOptional()
  @IsString()
  flossingFrequency?: string;

  @ApiPropertyOptional({
    example: '1-2 times per day (Moderate Risk)',
    enum: [
      '3+ times per day (High Risk)',
      '1-2 times per day (Moderate Risk)',
      'Occasionally / Weekends only (Low Risk)',
    ],
  })
  @IsOptional()
  @IsString()
  sugarIntake?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  smokesTobacco?: boolean;

  @ApiPropertyOptional({
    example: 'Occasional',
    enum: ['Frequent', 'Occasional', 'Never'],
  })
  @IsOptional()
  @IsString()
  alcoholUse?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  substanceUse?: boolean;

  // Section 5: Clinical Examination (Clinician Only)
  @ApiPropertyOptional({
    example: 'Good',
    enum: ['Good', 'Fair', 'Poor'],
  })
  @IsOptional()
  @IsString()
  oralHygieneIndex?: string;

  @ApiPropertyOptional({ example: 'WNL (Within Normal Limits)' })
  @IsOptional()
  @IsString()
  softTissueFindings?: string;

  @ApiPropertyOptional({
    example: '2',
    enum: ['0', '1', '2', '3', '4'],
  })
  @IsOptional()
  @IsString()
  periodontalStatus?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  decayedTeeth?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  missingTeeth?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  filledTeeth?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  dmftScore?: number;

  @ApiPropertyOptional({
    example: 'Normal Class I',
    enum: ['Normal Class I', 'Malocclusion', 'TMJ Issues'],
  })
  @IsOptional()
  @IsString()
  occlusionStatus?: string;

  // Section 6: Risk Assessment (Clinician Only)
  @ApiPropertyOptional({
    example: 'Moderate Risk',
    enum: ['Low Risk', 'Moderate Risk', 'High Risk'],
  })
  @IsOptional()
  @IsString()
  cariesRisk?: string;

  @ApiPropertyOptional({
    example: 'Low Risk',
    enum: ['Low Risk', 'Moderate Risk', 'High Risk'],
  })
  @IsOptional()
  @IsString()
  periodontalRisk?: string;

  @ApiPropertyOptional({
    example: 'Low',
    enum: ['Low', 'Elevated'],
  })
  @IsOptional()
  @IsString()
  oralCancerRisk?: string;

  // Section 7: Patient Satisfaction
  @ApiPropertyOptional({
    example: 'Somewhat Satisfied',
    enum: ['Very Satisfied', 'Somewhat Satisfied', 'Dissatisfied'],
  })
  @IsOptional()
  @IsString()
  smileSatisfaction?: string;

  @ApiPropertyOptional({
    example: 'Very Confident',
    enum: ['Very Confident', 'Somewhat Confident', 'Not Confident'],
  })
  @IsOptional()
  @IsString()
  careConfidence?: string;
}
