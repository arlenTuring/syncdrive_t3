import { useEffect, useState } from 'react';

/** 追蹤 Shift / Alt 是否按住（框選、加選用） */
export function useModifierHeld() {
  const [shift, setShift] = useState(false);
  const [alt, setAlt] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(true);
      if (e.key === 'Alt') setAlt(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(false);
      if (e.key === 'Alt') setAlt(false);
    };
    const onBlur = () => {
      setShift(false);
      setAlt(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return { shift, alt, modifier: shift || alt };
};
