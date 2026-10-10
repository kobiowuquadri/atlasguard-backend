import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.assertUtf8();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Yoruba, Hausa and Igbo text (and the ₦ sign) cannot be stored in legacy single-byte
   * encodings. Fail fast with a clear message instead of failing mid-import.
   */
  private async assertUtf8(): Promise<void> {
    const rows = await this.$queryRaw<Array<{ encoding: string }>>`
      SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = current_database()`;
    const encoding = rows[0]?.encoding;
    if (encoding !== 'UTF8') {
      throw new Error(
        `The database uses ${encoding ?? 'an unknown'} encoding; AtlasGuard requires UTF8. ` +
          "Create it with: CREATE DATABASE <name> ENCODING 'UTF8' TEMPLATE template0 (see docs/setup.md).",
      );
    }
  }
}
