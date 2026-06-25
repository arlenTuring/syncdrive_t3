import type { RouteActionIconRule, WidgetDataBinding } from '../dashboard/types';

export type VehicleElementType = 'body' | 'text' | 'light' | 'door' | 'behavior';

export type VehicleMatchOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';

/** 依資料欄位條件替換圖片（車體／車燈） */
export interface VehicleImageRule {
  id: string;
  label?: string;
  sourceField: string;
  matchOp: VehicleMatchOp;
  threshold: string;
  imageFile: string;
  /** 命中時車體色（#hex） */
  tintColor?: string;
  priority?: number;
}

export interface VehicleElementBase {
  id: string;
  type: VehicleElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 旋轉角度（度），與地圖編輯器設施相同 */
  rotationDeg?: number;
  editPlaceholder?: string;
}

export interface VehicleBodyElement extends VehicleElementBase, WidgetDataBinding {
  type: 'body';
  defaultImage: string;
  defaultTintColor?: string;
  /** 無規則命中時，從此欄位讀取色碼（#hex）或健康狀態（OK/WARNING/ERROR） */
  colorField?: string;
  imageRules: VehicleImageRule[];
}

export interface VehicleTextElement extends VehicleElementBase, WidgetDataBinding {
  type: 'text';
  valueField: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  color: string;
  textAlign: 'left' | 'center' | 'right';
}

export interface VehicleLightElement extends VehicleElementBase, WidgetDataBinding {
  type: 'light';
  defaultImage: string;
  /** 為 true / 1 / on 時亮燈；未設則檢視模式恆亮 */
  visibilityField?: string;
  imageRules: VehicleImageRule[];
}

export interface VehicleDoorElement extends VehicleElementBase, WidgetDataBinding {
  type: 'door';
  /** 固定 door/door.svg 造型；此欄保留供日後擴充 */
  doorImage?: string;
  /** 門片填色（#hex） */
  defaultColor?: string;
  openPercentField: string;
  alarmField?: string;
  defaultOpenPercent: number;
}

export interface VehicleBehaviorElement extends VehicleElementBase, WidgetDataBinding {
  type: 'behavior';
  actionIconRules: RouteActionIconRule[];
  /** 對應 operation_actions 陣列索引；多個行為元件並排時使用 */
  actionSlot?: number;
}

export type VehicleElement =
  | VehicleBodyElement
  | VehicleTextElement
  | VehicleLightElement
  | VehicleDoorElement
  | VehicleBehaviorElement;

export interface VehicleDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string;
  elements: VehicleElement[];
  /** 編輯模式無即時資料時的預覽 payload */
  previewData?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type VehicleElementPatch = Partial<VehicleElement>;
