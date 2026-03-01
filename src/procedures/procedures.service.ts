import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PackageTier } from '@prisma/client';

export interface ProcedureDefinition {
  code: string;
  name: string;
  description?: string;
  cost: number;
  allowedTiers: PackageTier[];
}

@Injectable()
export class ProceduresService implements OnModuleInit {
  private readonly logger = new Logger(ProceduresService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Initialize default procedures on module start
   */
  async onModuleInit() {
    // Add a delay to ensure Prisma schema is pushed first
    await new Promise((resolve) => setTimeout(resolve, 5000));

    try {
      // Check if the table exists by attempting a simple query
      await this.prisma.procedure.findFirst().catch(() => {
        this.logger.warn(
          'Procedure table does not exist yet, skipping initialization',
        );
        return null;
      });

      await this.initializeProcedures();
    } catch (error) {
      this.logger.error(`Failed to initialize procedures: ${error.message}`);
      // Don't throw - allow module to load even if initialization fails
      // Procedures can be created manually or on next restart
    }
  }

  /**
   * Initialize default procedures if they don't exist
   * Protocol v5.0 Rate Card - Final for March 20th Launch
   */
  private async initializeProcedures() {
    const procedures: ProcedureDefinition[] = [
      // MenoBronze tier procedures
      {
        code: 'CONSULT',
        name: 'Consultation',
        description: 'General dental consultation',
        cost: 1000, // Updated to v5.0 rate card
        allowedTiers: [
          PackageTier.BRONZE,
          PackageTier.SILVER,
          PackageTier.GOLD,
        ],
      },
      {
        code: 'EXTRACT_SIMPLE',
        name: 'Simple Extraction',
        description: 'Simple tooth extraction',
        cost: 1500, // Updated to v5.0 rate card
        allowedTiers: [
          PackageTier.BRONZE,
          PackageTier.SILVER,
          PackageTier.GOLD,
        ],
      },
      {
        code: 'SCALING_POLISHING',
        name: 'Scaling & Polishing',
        description: 'Professional teeth cleaning',
        cost: 3500, // Updated to v5.0 rate card
        allowedTiers: [
          PackageTier.BRONZE,
          PackageTier.SILVER,
          PackageTier.GOLD,
        ],
      },
      // MenoSilver tier procedures (includes all Bronze)
      {
        code: 'FILLING_COMPOSITE',
        name: 'Composite Filling',
        description: 'Tooth-colored composite filling',
        cost: 4000, // Updated to v5.0 rate card
        allowedTiers: [PackageTier.SILVER, PackageTier.GOLD],
      },
      // MenoGold tier procedures (includes all Silver and Bronze)
      {
        code: 'ROOT_CANAL_ANTERIOR',
        name: 'Anterior Root Canal',
        description: 'Root canal treatment for front teeth',
        cost: 10000, // Updated to v5.0 rate card
        allowedTiers: [PackageTier.GOLD],
      },
      {
        code: 'ANTIBIOTIC_THERAPY',
        name: 'Antibiotic Therapy',
        description:
          'Includes: 5-day course of antibiotics (Amoxicillin/Metronidazole) + pain management (Ibuprofen/Paracetamol)',
        cost: 1000, // Updated to v5.0 rate card
        allowedTiers: [PackageTier.GOLD],
      },
    ];

    for (const proc of procedures) {
      const existing = await this.prisma.procedure.findUnique({
        where: { code: proc.code },
      });

      if (!existing) {
        await this.prisma.procedure.create({
          data: {
            code: proc.code,
            name: proc.name,
            description: proc.description,
            cost: proc.cost,
            allowedTiers: proc.allowedTiers as any, // Store as JSON array
            isActive: true,
          },
        });
        this.logger.log(`Created procedure: ${proc.code} - ${proc.name}`);
      } else {
        // Update if exists (in case of changes)
        await this.prisma.procedure.update({
          where: { code: proc.code },
          data: {
            name: proc.name,
            description: proc.description,
            cost: proc.cost,
            allowedTiers: proc.allowedTiers as any,
          },
        });
      }
    }

    this.logger.log('Procedures initialized');
  }

  /**
   * Get all active procedures
   */
  async getAllProcedures() {
    return this.prisma.procedure.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Get procedures allowed for a specific tier
   */
  async getProceduresForTier(tier: PackageTier) {
    const allProcedures = await this.getAllProcedures();

    return allProcedures.filter((proc) => {
      const allowedTiers = proc.allowedTiers as string[];
      return allowedTiers.includes(tier);
    });
  }

  /**
   * Get procedure by code
   */
  async getProcedureByCode(code: string) {
    return this.prisma.procedure.findUnique({
      where: { code },
    });
  }

  /**
   * Get procedure by ID
   */
  async getProcedureById(id: string) {
    return this.prisma.procedure.findUnique({
      where: { id },
    });
  }
}
