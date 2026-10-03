/* 由 scripts/collect-system-query-history.ts 產生，請勿手改。 */
/**
 * 系統內建查詢在 git 歷史裡出現過的每一版（指紋見 utils/sqlFingerprint.ts）。
 * 使用中的版面若某個來源的 SQL 指紋在這裡，代表它是系統某一版的原文，可以安全換成目前版本。
 */
export const SYSTEM_QUERY_HISTORY: ReadonlyArray<{ family: string; fingerprint: string; firstSeen: string; commit: string }> = [
  {
    "family": "mainline-fleet",
    "fingerprint": "088c74e86b9704",
    "firstSeen": "2026-09-06",
    "commit": "2c6784a"
  },
  {
    "family": "mainline-fleet",
    "fingerprint": "19cec9b8a7e7ab",
    "firstSeen": "2026-09-17",
    "commit": "b1fbb38"
  },
  {
    "family": "mainline-fleet",
    "fingerprint": "0416ad9e2688e3",
    "firstSeen": "2026-09-19",
    "commit": "18d9b4d"
  },
  {
    "family": "mainline-shifts",
    "fingerprint": "0fd5d92828e873",
    "firstSeen": "2026-09-06",
    "commit": "2c6784a"
  },
  {
    "family": "mainline-shifts",
    "fingerprint": "1b12f554bfee0f",
    "firstSeen": "2026-09-17",
    "commit": "b1fbb38"
  },
  {
    "family": "mainline-shifts",
    "fingerprint": "07cb280282aa44",
    "firstSeen": "2026-09-19",
    "commit": "18d9b4d"
  },
  {
    "family": "mainline-shifts",
    "fingerprint": "17e9d6e55400a0",
    "firstSeen": "2026-09-20",
    "commit": "ce538a4"
  },
  {
    "family": "mainline-shifts",
    "fingerprint": "0066b21467ed96",
    "firstSeen": "2026-10-02",
    "commit": "2bb7bbe"
  },
  {
    "family": "maintenance-shifts",
    "fingerprint": "184c79f1ecb13a",
    "firstSeen": "2026-09-06",
    "commit": "2c6784a"
  },
  {
    "family": "maintenance-shifts",
    "fingerprint": "0c91988215edff",
    "firstSeen": "2026-09-17",
    "commit": "b1fbb38"
  },
  {
    "family": "maintenance-shifts",
    "fingerprint": "137e1bd9d25868",
    "firstSeen": "2026-09-19",
    "commit": "18d9b4d"
  },
  {
    "family": "maintenance-shifts",
    "fingerprint": "172dfe8eb136b8",
    "firstSeen": "2026-10-02",
    "commit": "2bb7bbe"
  },
  {
    "family": "vehicle-status",
    "fingerprint": "0676fe3f00c473",
    "firstSeen": "2026-09-06",
    "commit": "2c6784a"
  },
  {
    "family": "vehicle-status",
    "fingerprint": "1add8a7736d78c",
    "firstSeen": "2026-09-15",
    "commit": "d906b66"
  },
  {
    "family": "vehicle-status",
    "fingerprint": "06171b3736f11a",
    "firstSeen": "2026-09-17",
    "commit": "b1fbb38"
  },
  {
    "family": "vehicle-status",
    "fingerprint": "1bcace83f92080",
    "firstSeen": "2026-09-19",
    "commit": "18d9b4d"
  },
  {
    "family": "vehicle-status",
    "fingerprint": "16c07b8342eea1",
    "firstSeen": "2026-10-01",
    "commit": "2129bf4"
  },
  {
    "family": "vehicle-status",
    "fingerprint": "0440696e07d788",
    "firstSeen": "2026-10-02",
    "commit": "2bb7bbe"
  }
];
