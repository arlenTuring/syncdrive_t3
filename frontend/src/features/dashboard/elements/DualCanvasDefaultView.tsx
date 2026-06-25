import type { CanvasElementProps } from '../types';
import { WidgetRenderer } from './WidgetRenderer';
import { VariableProvider } from '../VariableContext';
import { EditModeProvider } from '../context/EditModeContext';
import { getDefaultChildren } from '../utils/dualCanvas';
import { Edit3 } from 'lucide-react';

function buildIndexVariables(element: CanvasElementProps): Record<string, number> {
  const varName = element.variableName || 'item';
  return { [varName]: 0 };
}

export function DualCanvasDefaultView({
  element,
  isEditMode,
  onEnterEditMode,
}: {
  element: CanvasElementProps;
  isEditMode: boolean;
  onEnterEditMode: () => void;
}) {
  const children = getDefaultChildren(element);
  const variables = buildIndexVariables(element);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <VariableProvider variables={variables}>
        <EditModeProvider value={isEditMode}>
          <div className="relative h-full w-full">
            {children.map(child => (
              <div
                key={child.id}
                style={{
                  position: 'absolute',
                  left: child.x,
                  top: child.y,
                  width: child.width,
                  height: child.height,
                  zIndex: child.type === 'color-block' ? 0 : 1,
                }}
              >
                <WidgetRenderer widget={child} />
              </div>
            ))}
          </div>
        </EditModeProvider>
      </VariableProvider>

      {isEditMode && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center rounded opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100"
          style={{ pointerEvents: 'none' }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEnterEditMode();
            }}
            className="pointer-events-auto flex items-center gap-2 rounded bg-purple-600 px-4 py-2 text-sm font-bold text-white shadow-lg hover:bg-purple-500"
          >
            <Edit3 size={16} /> 編輯子畫布範本
          </button>
        </div>
      )}
    </div>
  );
}
