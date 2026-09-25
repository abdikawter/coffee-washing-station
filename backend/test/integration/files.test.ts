import request from 'supertest';
import { bearer, createTestApp, tokenFor, type TestContext } from '../helpers/app.js';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(() => ctx.close());

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

describe('files', () => {
  it('stores an image, returns metadata with sha256, and lets the uploader download it', async () => {
    const clerk = await tokenFor(ctx, ['PURCHASING_CLERK']);
    const up = await request(ctx.app).post('/api/v1/files').set(bearer(clerk.token))
      .field('category', 'SUPPLIER_ID').attach('file', PNG, { filename: 'id-card.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ category: 'SUPPLIER_ID', mimeType: 'image/png', sizeBytes: PNG.length, provider: 'LOCAL', uploadedById: clerk.userId });
    expect(up.body.data).not.toHaveProperty('storageKey');
    const dl = await request(ctx.app).get(`/api/v1/files/${up.body.data.id}/content`).set(bearer(clerk.token)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c)).on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body as Buffer, PNG)).toBe(0);
    expect(dl.headers['content-disposition']).toMatch(/attachment; filename="id-card.png"/);

    // another uploader without file:read cannot read it; an auditor (file:read) can
    const other = await tokenFor(ctx, ['PULPING_OPERATOR']);
    expect((await request(ctx.app).get(`/api/v1/files/${up.body.data.id}`).set(bearer(other.token))).status).toBe(403);
    const auditor = await tokenFor(ctx, ['AUDITOR']);
    expect((await request(ctx.app).get(`/api/v1/files/${up.body.data.id}`).set(bearer(auditor.token))).status).toBe(200);
  });

  it('rejects disguised files and missing files', async () => {
    const clerk = await tokenFor(ctx, ['PURCHASING_CLERK']);
    const html = await request(ctx.app).post('/api/v1/files').set(bearer(clerk.token))
      .field('category', 'OTHER').attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'photo.png', contentType: 'image/png' });
    expect(html.status).toBe(400);
    const none = await request(ctx.app).post('/api/v1/files').set(bearer(clerk.token)).field('category', 'OTHER');
    expect(none.status).toBe(400);
  });

  it('TEMP_WORKER cannot upload', async () => {
    const w = await tokenFor(ctx, ['TEMP_WORKER']);
    const res = await request(ctx.app).post('/api/v1/files').set(bearer(w.token)).field('category', 'OTHER').attach('file', PNG, 'a.png');
    expect(res.status).toBe(403);
  });
});
