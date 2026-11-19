import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { ContextFileStorageService } from './context-file-storage.service';

/**
 * The bucket lives in us-west-2, while the service-wide AWS_REGION is set for
 * SES (us-east-1). Using the wrong region makes every upload fail with a
 * PermanentRedirect, which surfaced to admins only as "An unexpected error
 * occurred". These tests pin the region resolution so that cannot regress.
 */
describe('ContextFileStorageService (S3 region)', () => {
  const build = (values: Record<string, string | undefined>) =>
    new ContextFileStorageService({
      get: (key: string) => values[key],
    } as unknown as ConfigService);

  const regionOf = async (svc: ContextFileStorageService): Promise<string> => {
    const client = (svc as unknown as { s3: S3Client }).s3;
    return client.config.region();
  };

  it('defaults to us-west-2, where the context bucket lives', async () => {
    const svc = build({});
    await expect(regionOf(svc)).resolves.toBe('us-west-2');
  });

  it('ignores the shared AWS_REGION so SES settings cannot break uploads', async () => {
    const svc = build({ AWS_REGION: 'us-east-1' });
    await expect(regionOf(svc)).resolves.toBe('us-west-2');
  });

  it('honours BRAND_CONTEXT_S3_REGION when set explicitly', async () => {
    const svc = build({ BRAND_CONTEXT_S3_REGION: 'eu-west-1' });
    await expect(regionOf(svc)).resolves.toBe('eu-west-1');
  });
});
