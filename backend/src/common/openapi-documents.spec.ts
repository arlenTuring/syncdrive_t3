import type { OpenAPIObject } from '@nestjs/swagger';
import { filterExternalDocument } from './openapi-documents';

/**
 * 對外文件的過濾是<strong>安全邊界</strong>，不是排版。漏掉一支端點、留下一個
 * 內部 schema，都是把不該給的東西交到協力廠商手上，所以這裡逐條釘住。
 */
function makeDocument(): OpenAPIObject {
  return {
    openapi: '3.0.0',
    info: { title: '內部', version: '1.0' },
    tags: [{ name: 'Operation Shifts' }, { name: '對外｜班表計畫' }],
    paths: {
      '/syncdrive-api/operation-shift/timetable/trips': {
        get: {
          tags: ['Operation Shifts', '對外｜班表計畫'],
          responses: {
            200: {
              description: 'ok',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TripsResponse' },
                },
              },
            },
          },
        },
      },
      '/syncdrive-api/operation-shift/detail/{id}': {
        get: { tags: ['Operation Shifts'], responses: {} },
        delete: { tags: ['Operation Shifts'], responses: {} },
      },
    },
    components: {
      securitySchemes: {
        'x-api-key': { type: 'apiKey', name: 'x-api-key', in: 'header' },
      },
      schemas: {
        TripsResponse: {
          type: 'object',
          properties: { trips: { $ref: '#/components/schemas/Trip' } },
        },
        Trip: { type: 'object', properties: { trip_code: { type: 'string' } } },
        InternalOnlyShiftBody: { type: 'object' },
      },
    },
  } as unknown as OpenAPIObject;
}

describe('filterExternalDocument', () => {
  it('只留下標了對外的操作', () => {
    const out = filterExternalDocument(makeDocument());
    expect(Object.keys(out.paths)).toEqual([
      '/syncdrive-api/operation-shift/timetable/trips',
    ]);
  });

  it('同一路徑上未標記的方法要被剔除', () => {
    const document = makeDocument();
    (
      document.paths['/syncdrive-api/operation-shift/timetable/trips'] as any
    ).delete = {
      tags: ['Operation Shifts'],
      responses: {},
    };
    const out = filterExternalDocument(document);
    const item = out.paths[
      '/syncdrive-api/operation-shift/timetable/trips'
    ] as any;
    expect(Object.keys(item)).toEqual(['get']);
  });

  it('不把內部分組名帶進對外文件', () => {
    const out = filterExternalDocument(makeDocument());
    const operation = (
      out.paths['/syncdrive-api/operation-shift/timetable/trips'] as any
    ).get;
    expect(operation.tags).toEqual(['對外｜班表計畫']);
    expect(out.tags?.map((tag) => tag.name)).toEqual(['對外｜班表計畫']);
  });

  it('只保留對外路徑參照得到的 schema，遞移參照要跟著留', () => {
    const out = filterExternalDocument(makeDocument());
    expect(Object.keys(out.components?.schemas ?? {})).toEqual([
      'Trip',
      'TripsResponse',
    ]);
  });

  it('保留 x-api-key 定義——對外端點全部需要它', () => {
    const out = filterExternalDocument(makeDocument());
    expect(out.components?.securitySchemes).toHaveProperty('x-api-key');
  });

  it('沒有任何對外端點時回傳空的 paths，而不是整份內部文件', () => {
    const document = makeDocument();
    for (const item of Object.values(document.paths)) {
      for (const operation of Object.values(item as Record<string, any>)) {
        operation.tags = ['Operation Shifts'];
      }
    }
    const out = filterExternalDocument(document);
    expect(out.paths).toEqual({});
    expect(out.components?.schemas).toEqual({});
  });
});
