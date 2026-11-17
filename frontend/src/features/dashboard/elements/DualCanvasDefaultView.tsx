import type { CanvasElementProps } from '../types';
import { WidgetRenderer } from './WidgetRenderer';
import { VariableProvider } from '../VariableContext';
import { EditModeProvider } from '../context/EditModeContext';
import { getDefaultChildren } from '../utils/dualCanvas';
import { Edit3 } from 'lucide-react';
import { Button } from '../../../components/ui';

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
          <Button className="pointer-events-auto" leadingIcon={<Edit3 />} onPress={(e) => {
              e.stopPropagation();
              onEnterEditMode();
            }}>編輯子畫布範本</Button>
        </div>
      )}
    </div>
  );
}
