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
    try {
      await this.initializeProcedures();
    } catch (error) {
      this.logger.error(`Failed to initialize procedures: ${error.message}`);
      // Don't throw - allow module to load even if initialization fails
      // Procedures can be created manually or on next restart
    }
  }

  /**
   * Initialize default procedures if they don't exist
   */
  private async initializeProcedures() {
    const procedures: ProcedureDefinition[] = [
      // Bronze tier procedures
      {
        code: 'CONSULT',
        name: 'Consultation',
        description: 'General dental consultation',
        cost: 500,
        allowedTiers: [PackageTier.BRONZE, PackageTier.SILVER, PackageTier.GOLD],
      },
      {
        code: 'SCREEN_BASIC',
        name: 'Basic Screening',
        description: 'Basic dental screening',
        cost: 300,
        allowedTiers: [PackageTier.BRONZE, PackageTier.SILVER, PackageTier.GOLD],
      },
      {
        code: 'PAIN_RELIEF',
        name: 'Pain Relief (Panadol)',
        description: 'Pain relief medication',
        cost: 200,
        allowedTiers: [PackageTier.BRONZE, PackageTier.SILVER, PackageTier.GOLD],
      },
      // Silver tier procedures (includes all Bronze)
      {
        code: 'EXTRACT_SIMPLE',
        name: 'Simple Extraction',
        description: 'Simple tooth extraction',
        cost: 800,
        allowedTiers: [PackageTier.SILVER, PackageTier.GOLD],
      },
      {
        code: 'FILLING_L1',
        name: 'Filling (Level 1)',
        description: 'Basic dental filling',
        cost: 1200,
        allowedTiers: [PackageTier.SILVER, PackageTier.GOLD],
      },
      // Gold tier procedures (includes all Silver and Bronze)
      {
        code: 'EXTRACT_COMPLEX',
        name: 'Complex Extraction',
        description: 'Complex tooth extraction',
        cost: 1500,
        allowedTiers: [PackageTier.GOLD],
      },
      {
        code: 'XRAY',
        name: 'X-Ray',
        description: 'Dental X-Ray imaging',
        cost: 1000,
        allowedTiers: [PackageTier.GOLD],
      },
      {
        code: 'ROOT_CANAL_EMERGENCY',
        name: 'Root Canal (Emergency)',
        description: 'Emergency root canal treatment',
        cost: 5000,
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
