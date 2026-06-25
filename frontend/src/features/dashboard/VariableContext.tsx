import React, { createContext, useContext, useMemo } from 'react';

export type VariableMap = Record<string, string | number | boolean | null | undefined>;

const VariableContext = createContext<VariableMap>({});

function stableVarKey(vars: VariableMap): string {
  const keys = Object.keys(vars).sort();
  return keys.map(k => `${k}:${String(vars[k])}`).join('|');
}

export function VariableProvider({ variables, children }: { variables: VariableMap, children: React.ReactNode }) {
  const parentVars = useContext(VariableContext);
  const parentKey = stableVarKey(parentVars);
  const localKey = stableVarKey(variables);
  const mergedVars = useMemo(
    () => ({ ...parentVars, ...variables }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 以 stableVarKey 避免每 render 新物件導致 MQTT/SQL 重訂閱
    [parentKey, localKey],
  );

  return (
    <VariableContext.Provider value={mergedVars}>
      {children}
    </VariableContext.Provider>
  );
}

export function useVariables() {
  return useContext(VariableContext);
}

/**
 * 將字串中的變數占位替換為 context 值。
 * 支援：${varName}（MQTT 主題常用）、{varName}（畫布文字常用）
 */
export function interpolateVariables(str: string | undefined | null, variables: VariableMap): string {
  if (!str) return '';
  const resolve = (key: string, match: string) => {
    const trimmedKey = key.trim();
    if (variables[trimmedKey] !== undefined && variables[trimmedKey] !== null) {
      return String(variables[trimmedKey]);
    }
    return match;
  };
  return str
    .replace(/\$\{(\w+)\}/g, (match, key) => resolve(key, match))
    .replace(/\{([^{}]+)\}/g, (match, key) => resolve(key, match));
}
