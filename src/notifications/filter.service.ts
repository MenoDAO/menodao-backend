import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecipientFilters } from './dto/recipient-filters.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class FilterService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get list of member phone numbers matching filters
   */
  async getFilteredRecipients(filters: RecipientFilters): Promise<string[]> {
    const whereClause = this.buildWhereClause(filters);

    const members = await this.prisma.member.findMany({
      where: whereClause,
      select: {
        phoneNumber: true,
      },
    });

    return members.map((m) => m.phoneNumber);
  }

  /**
   * Count members matching filters
   */
  async countFilteredRecipients(filters: RecipientFilters): Promise<number> {
    const whereClause = this.buildWhereClause(filters);

    return this.prisma.member.count({
      where: whereClause,
    });
  }

  /**
   * Build Prisma where clause combining all filter criteria with AND logic
   */
  private buildWhereClause(filters: RecipientFilters): Prisma.MemberWhereInput {
    const conditions: Prisma.MemberWhereInput[] = [];

    // Handle single phone number filter
    if (filters.singlePhoneNumber) {
      if (!this.validatePhoneNumber(filters.singlePhoneNumber)) {
        throw new BadRequestException(
          `Invalid phone number format: ${filters.singlePhoneNumber}`,
        );
      }
      return { phoneNumber: filters.singlePhoneNumber };
    }

    // Handle CSV phone numbers filter
    if (filters.csvPhoneNumbers && filters.csvPhoneNumbers.length > 0) {
      return { phoneNumber: { in: filters.csvPhoneNumbers } };
    }

    // Package type filter
    if (filters.packageTypes && filters.packageTypes.length > 0) {
      conditions.push({
        subscription: {
          tier: { in: filters.packageTypes },
        },
      });
    }

    // Date joined filter
    if (filters.dateJoinedFrom || filters.dateJoinedTo) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (filters.dateJoinedFrom) {
        dateFilter.gte = filters.dateJoinedFrom;
      }
      if (filters.dateJoinedTo) {
        dateFilter.lte = filters.dateJoinedTo;
      }
      conditions.push({
        createdAt: dateFilter,
      });
    }

    // Balance accrued filter - Note: The schema doesn't have a balanceAccrued field
    // This would need to be calculated from contributions or added to the schema
    // For now, we'll skip this filter or throw an error
    if (filters.balanceMin !== undefined || filters.balanceMax !== undefined) {
      // TODO: Implement balance filtering once balance field is added to Member model
      // or calculate from contributions
      throw new BadRequestException('Balance filtering is not yet implemented');
    }

    // Subscription status filter
    if (filters.subscriptionStatus) {
      conditions.push({
        subscription: {
          isActive: filters.subscriptionStatus === 'active',
        },
      });
    }

    // Combine all conditions with AND logic
    if (conditions.length === 0) {
      return {};
    }

    return { AND: conditions };
  }

  /**
   * Validate phone number format
   */
  validatePhoneNumber(phone: string): boolean {
    // Basic validation for international phone numbers
    // Accepts formats like: +254712345678, 254712345678, 0712345678
    const phoneRegex = /^(\+?254|0)?[17]\d{8}$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
  }

  /**
   * Parse CSV file and extract valid phone numbers
   */
  parseCSVPhoneNumbers(fileBuffer: Buffer): {
    valid: string[];
    errors: string[];
  } {
    const valid: string[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    try {
      const content = fileBuffer.toString('utf-8');
      const lines = content.split(/\r?\n/);

      // Skip header row if it looks like a header
      const startIndex =
        lines[0] &&
        (lines[0].toLowerCase().includes('phone') ||
          lines[0].toLowerCase().includes('number'))
          ? 1
          : 0;

      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue; // Skip empty lines

        // Extract first column (split by comma, semicolon, or tab)
        const columns = line.split(/[,;\t]/);
        const phoneNumber = columns[0].trim();

        if (!phoneNumber) continue;

        // Validate phone number
        if (!this.validatePhoneNumber(phoneNumber)) {
          errors.push(`Line ${i + 1}: Invalid phone number "${phoneNumber}"`);
          continue;
        }

        // Normalize phone number format
        const normalized = this.normalizePhoneNumber(phoneNumber);

        // Deduplicate
        if (seen.has(normalized)) {
          continue;
        }

        seen.add(normalized);
        valid.push(normalized);
      }

      return { valid, errors };
    } catch {
      throw new BadRequestException('Failed to parse CSV file');
    }
  }

  /**
   * Normalize phone number to consistent format (+254...)
   */
  private normalizePhoneNumber(phone: string): string {
    // Remove spaces
    let normalized = phone.replace(/\s/g, '');

    // Convert 0712345678 to +254712345678
    if (normalized.startsWith('0')) {
      normalized = '+254' + normalized.substring(1);
    }
    // Convert 254712345678 to +254712345678
    else if (normalized.startsWith('254')) {
      normalized = '+' + normalized;
    }
    // Already in +254 format
    else if (!normalized.startsWith('+')) {
      normalized = '+254' + normalized;
    }

    return normalized;
  }
}
