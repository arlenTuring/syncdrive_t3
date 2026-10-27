-- 即時圖台三張進站動態卡片（eta-t3／eta-s2w／eta-n2w）改成最多三列：即將到站的列放大，
-- 同時兩班即將到站只排兩列（前端 stationEtaModel.cardRows）。原本筆數 2 補成 3；
-- 已經是 3 以上的不動，其他元件、座標、資料綁定不動。只改內容，版本號加一讓開著的編輯器知道有新版（可重跑）。
WITH target AS (
  SELECT p.id,
         (
           SELECT COALESCE(jsonb_agg(
             CASE WHEN jsonb_typeof(el->'children') = 'array' THEN jsonb_set(el, '{children}', (
               SELECT COALESCE(jsonb_agg(
                 CASE WHEN ch->>'type' = 'station-eta'
                       AND ch->>'id' IN ('eta-t3', 'eta-s2w', 'eta-n2w')
                       AND COALESCE(NULLIF(ch->>'limit', '')::numeric, 0) < 3
                      THEN jsonb_set(ch, '{limit}', '3'::jsonb)
                      ELSE ch END
                 ORDER BY ci), '[]'::jsonb)
               FROM jsonb_array_elements(el->'children') WITH ORDINALITY AS c(ch, ci)
             )) ELSE el END
             ORDER BY ei), '[]'::jsonb)
           FROM jsonb_array_elements(p.elements) WITH ORDINALITY AS e(el, ei)
         ) AS elements
  FROM dashboard_planes p
  WHERE jsonb_typeof(p.elements) = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p.elements) AS e(el),
           jsonb_array_elements(CASE WHEN jsonb_typeof(el->'children') = 'array' THEN el->'children' ELSE '[]'::jsonb END) AS c(ch)
      WHERE ch->>'type' = 'station-eta'
        AND ch->>'id' IN ('eta-t3', 'eta-s2w', 'eta-n2w')
        AND COALESCE(NULLIF(ch->>'limit', '')::numeric, 0) < 3
    )
)
UPDATE dashboard_planes p
SET elements = target.elements,
    version = p.version + 1,
    updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
FROM target
WHERE p.id = target.id;
