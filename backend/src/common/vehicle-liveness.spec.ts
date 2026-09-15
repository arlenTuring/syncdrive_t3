import {
  isFreshHeartbeat,
  isVehicleOffline,
  VEHICLE_HEALTH_OFFLINE,
  VEHICLE_OFFLINE_AFTER_MS_DEFAULT,
  withDerivedOffline,
} from './vehicle-liveness';

describe('失聯判定', () => {
  const THRESHOLD = VEHICLE_OFFLINE_AFTER_MS_DEFAULT;

  describe('retain 重送不能刷新存活', () => {
    it('時間戳相同就是 broker 補送的那一則', () => {
      const previous = { receivedAt: 1_000, timestamp: '1700000000000' };
      expect(isFreshHeartbeat(previous, '1700000000000')).toBe(false);
    });

    it('時間戳變了就是新的一拍', () => {
      const previous = { receivedAt: 1_000, timestamp: '1700000000000' };
      expect(isFreshHeartbeat(previous, '1700000001000')).toBe(true);
    });

    it('第一次收到一律算數', () => {
      expect(isFreshHeartbeat(null, '1700000000000')).toBe(true);
    });

    it('車端沒帶時間戳時無從比對，當成新的一拍', () => {
      const previous = { receivedAt: 1_000, timestamp: '1700000000000' };
      expect(isFreshHeartbeat(previous, null)).toBe(true);
    });
  });

  describe('門檻', () => {
    it('心跳 1 Hz，預設五秒＝連掉四拍才判失聯', () => {
      expect(THRESHOLD).toBe(5_000);
    });

    it('剛好卡在門檻上還算在線', () => {
      const mark = { receivedAt: 10_000, timestamp: 'a' };
      expect(isVehicleOffline(mark, 10_000 + THRESHOLD, THRESHOLD)).toBe(false);
    });

    it('超過門檻判失聯', () => {
      const mark = { receivedAt: 10_000, timestamp: 'a' };
      expect(isVehicleOffline(mark, 10_000 + THRESHOLD + 1, THRESHOLD)).toBe(true);
    });

    it('一次都沒收到過就是失聯', () => {
      expect(isVehicleOffline(null, 10_000, THRESHOLD)).toBe(true);
    });
  });

  describe('推導值疊在輸出上', () => {
    const mark = { receivedAt: 10_000, timestamp: 'a' };

    it('失聯時蓋掉車端上報的 overall_health', () => {
      const out = withDerivedOffline({ overall_health: 'OK', subsystems: {} }, true, mark);
      expect(out?.overall_health).toBe(VEHICLE_HEALTH_OFFLINE);
      expect(out?.offline).toBe(true);
      expect(out?.last_seen_at).toBe(10_000);
      // 車端上報的其餘欄位保持原樣
      expect(out?.subsystems).toEqual({});
    });

    it('在線時原樣送出車端的值', () => {
      const out = withDerivedOffline({ overall_health: 'WARNING' }, false, mark);
      expect(out?.overall_health).toBe('WARNING');
      expect(out?.offline).toBe(false);
    });

    it('從未收到過心跳時，只回報失聯本身', () => {
      const out = withDerivedOffline(null, true, null);
      expect(out).toEqual({
        overall_health: VEHICLE_HEALTH_OFFLINE,
        offline: true,
        last_seen_at: null,
      });
    });

    it('沒有快取又沒失聯就沒有東西可回', () => {
      expect(withDerivedOffline(null, false, mark)).toBeNull();
    });
  });
});
