import { useState } from 'react';
import { DrivingCapabilityModal } from './components/DrivingCapabilityModal';
import { ShiftRecordsListPage } from './components/ShiftRecordsListPage';

type ShiftRecordsAppProps = {
  onBackToHome?: () => void;
  embedded?: boolean;
};

export default function ShiftRecordsApp({ onBackToHome, embedded }: ShiftRecordsAppProps) {
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);

  return (
    <>
      <ShiftRecordsListPage
        onBackToHome={embedded ? undefined : onBackToHome}
        onOpenDetail={setDetailOrderId}
        embedded={embedded}
      />
      {detailOrderId && (
        <DrivingCapabilityModal
          orderId={detailOrderId}
          onClose={() => setDetailOrderId(null)}
        />
      )}
    </>
  );
}
