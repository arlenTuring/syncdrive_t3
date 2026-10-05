import * as fs from 'fs';
import { backendScriptPath } from './backend-script-path';

describe('backendScriptPath', () => {
  it('finds backend scripts independently of the compiled source depth', () => {
    expect(fs.existsSync(backendScriptPath('map-operation-nodes.js'))).toBe(true);
  });
});
