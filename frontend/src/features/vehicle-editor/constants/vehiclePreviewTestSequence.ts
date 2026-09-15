export interface VehiclePreviewTestStep {
  label: string;
  data: Record<string, unknown>;
}

function doorFields(
  fl: number,
  fr: number,
  rl: number,
  rr: number,
): Record<string, number> {
  return {
    door_fl_open_percent: fl,
    door_fr_open_percent: fr,
    door_rl_open_percent: rl,
    door_rr_open_percent: rr,
    door_open_percent: Math.max(fl, fr, rl, rr),
  };
}

/** 線性預覽測試：班次 → 方向 → 車門 → 車燈 → 行為做動 */
export const VEHICLE_PREVIEW_TEST_SEQUENCE: VehiclePreviewTestStep[] = [
  {
    label: '1 · 下行班次 D0950 · 關門 · 燈滅 · 充電',
    data: {
      trip_code: 'D0950',
      badge_label: 'D0950',
      direction_label: '下行',
      vehicle_code: 'PMS01',
      ...doorFields(0, 0, 0, 0),
      head_light_on: false,
      tail_light_on: false,
      operation_actions: ['charging'],
      operation_action: 'charging',
    },
  },
  {
    label: '2 · 切換上行班次 U0951',
    data: {
      trip_code: 'U0951',
      badge_label: 'U0951',
      direction_label: '上行',
      vehicle_code: 'PMS01',
      ...doorFields(0, 0, 0, 0),
      head_light_on: false,
      tail_light_on: false,
      operation_actions: ['charging'],
      operation_action: 'charging',
    },
  },
  {
    label: '3 · 前後燈亮起',
    data: {
      trip_code: 'U0951',
      badge_label: 'U0951',
      direction_label: '上行',
      vehicle_code: 'PMS01',
      ...doorFields(0, 0, 0, 0),
      head_light_on: true,
      tail_light_on: true,
      operation_actions: ['charging'],
      operation_action: 'charging',
    },
  },
  {
    label: '4 · 前門半開、後門仍關',
    data: {
      trip_code: 'U0951',
      badge_label: 'U0951',
      direction_label: '上行',
      vehicle_code: 'PMS01',
      ...doorFields(50, 50, 0, 0),
      head_light_on: true,
      tail_light_on: true,
      operation_actions: ['door_open'],
      operation_action: 'door_open',
    },
  },
  {
    label: '5 · 四門全開 + 開門行為',
    data: {
      trip_code: 'U0951',
      badge_label: 'U0951',
      direction_label: '上行',
      vehicle_code: 'PMS01',
      ...doorFields(100, 100, 100, 100),
      head_light_on: true,
      tail_light_on: true,
      operation_actions: ['door_open'],
      operation_action: 'door_open',
    },
  },
  {
    label: '6 · 雙行為：開門 + 充電',
    data: {
      trip_code: 'U0951',
      badge_label: 'U0951',
      direction_label: '上行',
      vehicle_code: 'PMS01',
      ...doorFields(100, 100, 100, 100),
      head_light_on: true,
      tail_light_on: true,
      operation_actions: ['door_open', 'charging'],
      operation_action: 'door_open',
    },
  },
  {
    label: '7 · 關門 + 調度',
    data: {
      trip_code: 'U0951',
      badge_label: 'U0951',
      direction_label: '上行',
      vehicle_code: 'PMS01',
      ...doorFields(0, 0, 0, 0),
      head_light_on: true,
      tail_light_on: true,
      operation_actions: ['door_close', 'dispatch'],
      operation_action: 'dispatch',
    },
  },
  {
    label: '8 · 切換下行 D0952 · 告警',
    data: {
      trip_code: 'D0952',
      badge_label: 'D0952',
      direction_label: '下行',
      vehicle_code: 'PMS01',
      ...doorFields(0, 0, 0, 0),
      head_light_on: true,
      tail_light_on: false,
      operation_actions: ['alert'],
      operation_action: 'alert',
    },
  },
  {
    label: '9 · 洗車 + 號誌',
    data: {
      trip_code: 'D0952',
      badge_label: 'D0952',
      direction_label: '下行',
      vehicle_code: 'PMS01',
      ...doorFields(0, 0, 0, 0),
      head_light_on: false,
      tail_light_on: true,
      operation_actions: ['wash', 'signal'],
      operation_action: 'wash',
    },
  },
  {
    label: '10 · 臨停 · 燈滅 · 關門',
    data: {
      trip_code: 'D0952',
      badge_label: 'D0952',
      direction_label: '下行',
      vehicle_code: 'PMS01',
      ...doorFields(0, 0, 0, 0),
      head_light_on: false,
      tail_light_on: false,
      operation_actions: ['parking'],
      operation_action: 'parking',
    },
  },
];

export const VEHICLE_PREVIEW_TEST_INTERVAL_MS = 2800;
