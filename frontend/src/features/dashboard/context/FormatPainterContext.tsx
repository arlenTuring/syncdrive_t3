import { createContext, useContext, type ReactNode } from 'react';
import type { ChildWidget } from '../types';
import type { WidgetFormatSnapshot } from '../utils/widgetFormatPainter';

export type FormatPainterApi = {
  armed: WidgetFormatSnapshot | null;
  arm: (widget: ChildWidget) => void;
  cancel: () => void;
  canApplyTo: (widget: ChildWidget) => boolean;
  apply: (canvasId: string, widget: ChildWidget) => boolean;
};

const FormatPainterContext = createContext<FormatPainterApi | null>(null);

export function FormatPainterProvider({
  value,
  children,
}: {
  value: FormatPainterApi;
  children: ReactNode;
}) {
  return <FormatPainterContext.Provider value={value}>{children}</FormatPainterContext.Provider>;
}

export function useFormatPainter(): FormatPainterApi | null {
  return useContext(FormatPainterContext);
}
