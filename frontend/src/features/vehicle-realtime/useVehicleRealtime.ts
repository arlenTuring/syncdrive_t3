import { useCallback, useEffect, useRef, useState } from 'react';
import { acquireSocket, releaseSocket } from '../dashboard/elements/socketManager';
import { getDataSourceById } from '../dashboard/store/useDataSourceStore';
import { fetchVehicleSnapshot, type VehicleSnapshotQuery } from './api';
import { mergeBufferedEnvelopes, mergeVehicleEnvelope } from './mergeVehicleState';
import type { StreamKind, VehicleSnapshotResponse, VehicleStateEnvelope } from './types';

type Buffered = Partial<Record<StreamKind, VehicleStateEnvelope>>;

export function useVehicleRealtime(query: VehicleSnapshotQuery) {
  const [response, setResponse] = useState<VehicleSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bufferedRef = useRef(new Map<string, Buffered>());
  const refreshRef = useRef<() => void>(() => undefined);

  const refresh = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchVehicleSnapshot(query, controller.signal)
      .then((snapshot) => {
        setResponse({
          ...snapshot,
          items: snapshot.items.map((item) => mergeBufferedEnvelopes(item, bufferedRef.current.get(item.vehicleCode))),
        });
      })
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query]);
  refreshRef.current = () => { refresh(); };

  // 先掛 Socket，再由下一個 effect 讀取快照；慢快照會再與 buffered 合併。
  useEffect(() => {
    const source = getDataSourceById('default-mqtt');
    const url = source?.type === 'mqtt' ? source.backendUrl : '';
    const socket = acquireSocket(url);
    const onState = (raw: VehicleStateEnvelope) => {
      if (!raw || !['telemetry', 'operation', 'health'].includes(raw.stream)) return;
      const code = String(raw.vehicleCode ?? '').toUpperCase();
      if (!code || !raw.payload || !Number.isFinite(raw.dataAt) || !Number.isFinite(raw.receivedAt)) return;
      const buffered = bufferedRef.current.get(code) ?? {};
      const current = buffered[raw.stream];
      if (!current || raw.dataAt > current.dataAt || (raw.dataAt === current.dataAt && raw.receivedAt > current.receivedAt)) {
        buffered[raw.stream] = raw;
        bufferedRef.current.set(code, buffered);
      }
      setResponse((previous) => previous ? {
        ...previous,
        items: previous.items.map((item) => item.vehicleCode === code ? mergeVehicleEnvelope(item, raw) : item),
      } : previous);
    };
    const onReconnect = () => refreshRef.current();
    socket.on('vehicle/state', onState);
    socket.on('connect', onReconnect);
    return () => {
      socket.off('vehicle/state', onState);
      socket.off('connect', onReconnect);
      releaseSocket(url);
    };
  }, []);

  useEffect(() => refresh(), [refresh]);

  return { response, loading, error, retry: refresh };
}
