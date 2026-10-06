/* 由 scripts/collect-system-query-history.ts 產生，請勿手改。 */
/**
 * 系統內建查詢在 git 歷史裡出現過的每一版（指紋見 utils/sqlFingerprint.ts）。
 * 使用中的版面若某個來源的 SQL 指紋在這裡，代表它是系統某一版的原文，可以安全換成目前版本。
 */
export const SYSTEM_QUERY_HISTORY: ReadonlyArray<{ family: string; fingerprint: string; firstSeen: string; commit: string }> = [
  {
    "family": "event-center-list",
    "fingerprint": "0b0f85305bed74",
    "firstSeen": "2026-06-25",
    "commit": "b52b1a6"
  },
  {
    "family": "event-center-list",
    "fingerprint": "1e742d4822e2b9",
    "firstSeen": "2026-10-01",
    "commit": "2129bf4"
  },
  {
    "family": "event-center-list",
    "fingerprint": "0b67580bbad6d7",
    "firstSeen": "2026-10-05",
    "commit": "c628653"
  },
  {
    "family": "mainline-fleet",
    "fingerprint": "0c886956767495",
    "firstSeen": "2026-06-25",
    "commit": "b52b1a6"
  },
  {
    "family": "mainline-fleet",
    "fingerprint": "088c74e86b9704",
    "firstSeen": "2026-08-26",
    "commit": "ad70d84"
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
    "family": "mainline-fleet",
    "fingerprint": "1a49ab6dd92da8",
    "firstSeen": "2026-10-05",
    "commit": "19084a1"
  },
  {
    "family": "mainline-fleet",
    "fingerprint": "0d291eb412da8f",
    "firstSeen": "2026-10-05",
    "commit": "bcced54"
  },
  {
    "family": "mainline-fleet",
    "fingerprint": "145d92ff20f740",
    "firstSeen": "2026-10-06",
    "commit": "3beb061"
  },
  {
    "family": "mainline-shifts",
    "fingerprint": "0dc1f5b1ae7657",
    "firstSeen": "2026-06-25",
    "commit": "b52b1a6"
  },
  {
    "family": "mainline-shifts",
    "fingerprint": "0deed2592049cf",
    "firstSeen": "2026-07-15",
    "commit": "eea4cd2"
  },
  {
    "family": "mainline-shifts",
    "fingerprint": "0fd5d92828e873",
    "firstSeen": "2026-08-26",
    "commit": "ad70d84"
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
    "family": "mainline-shifts",
    "fingerprint": "18b9adbf3d745c",
    "firstSeen": "2026-10-05",
    "commit": "19084a1"
  },
  {
    "family": "mainline-shifts",
    "fingerprint": "1573a65a8549f3",
    "firstSeen": "2026-10-05",
    "commit": "bcced54"
  },
  {
    "family": "mainline-shifts",
    "fingerprint": "1d16130413e9bd",
    "firstSeen": "2026-10-05",
    "commit": "082a90f"
  },
  {
    "family": "mainline-shifts",
    "fingerprint": "1106a666980f3f",
    "firstSeen": "2026-10-05",
    "commit": "6da2ac7"
  },
  {
    "family": "mainline-shifts",
    "fingerprint": "1483f2d7da35bc",
    "firstSeen": "2026-10-05",
    "commit": "646864a"
  },
  {
    "family": "mainline-shifts",
    "fingerprint": "00590e5b7e230f",
    "firstSeen": "2026-10-06",
    "commit": "3beb061"
  },
  {
    "family": "maintenance-shifts",
    "fingerprint": "08882334305f5d",
    "firstSeen": "2026-06-25",
    "commit": "b52b1a6"
  },
  {
    "family": "maintenance-shifts",
    "fingerprint": "06d16e8d9c3ebc",
    "firstSeen": "2026-06-25",
    "commit": "558be73"
  },
  {
    "family": "maintenance-shifts",
    "fingerprint": "1cbe6e7ccb3a32",
    "firstSeen": "2026-06-25",
    "commit": "214743e"
  },
  {
    "family": "maintenance-shifts",
    "fingerprint": "184c79f1ecb13a",
    "firstSeen": "2026-07-15",
    "commit": "eea4cd2"
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
    "family": "maintenance-shifts",
    "fingerprint": "1146e58962abac",
    "firstSeen": "2026-10-05",
    "commit": "19084a1"
  },
  {
    "family": "maintenance-shifts",
    "fingerprint": "1188b5d5a8ae2e",
    "firstSeen": "2026-10-05",
    "commit": "bcced54"
  },
  {
    "family": "maintenance-shifts",
    "fingerprint": "06c217fceda659",
    "firstSeen": "2026-10-06",
    "commit": "3beb061"
  },
  {
    "family": "vehicle-status",
    "fingerprint": "156c6f2c78cfa6",
    "firstSeen": "2026-06-25",
    "commit": "b52b1a6"
  },
  {
    "family": "vehicle-status",
    "fingerprint": "1716726ea1d4e8",
    "firstSeen": "2026-07-15",
    "commit": "eea4cd2"
  },
  {
    "family": "vehicle-status",
    "fingerprint": "0676fe3f00c473",
    "firstSeen": "2026-08-26",
    "commit": "ad70d84"
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
  },
  {
    "family": "vehicle-status",
    "fingerprint": "04a8d427aa2457",
    "firstSeen": "2026-10-05",
    "commit": "19084a1"
  },
  {
    "family": "vehicle-status",
    "fingerprint": "03ed2a0509c8c7",
    "firstSeen": "2026-10-05",
    "commit": "bcced54"
  },
  {
    "family": "vehicle-status",
    "fingerprint": "0af7bea2f89e1d",
    "firstSeen": "2026-10-06",
    "commit": "3beb061"
  }
];
