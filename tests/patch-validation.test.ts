import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validatePatch } from '../src/features/repair/patch-validator';
import { repairLoopEngine } from '../src/features/repair/repair-loop';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { verificationService } from '../src/features/verification/VerificationService';
import { Patch, ProjectFile } from '../src/types/workspace';

function makeProjectFile(projectId: string, path: string, content: string): ProjectFile {
  return {
    id: `${projectId}:${path}`,
    projectId,
    path,
    content,
    hash: 'h_1',
    updatedAt: new Date().toISOString(),
    language: 'typescript',
    isModified: false
  };
}

describe('Patch Validation & Safety (Tests A-K)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('A. valid single-file patch', () => {
    const files: Record<string, ProjectFile> = {
      '/src/App.tsx': makeProjectFile('proj', '/src/App.tsx', 'export const title = "old";')
    };

    const patch: Patch = {
      id: 'patch-1',
      summary: 'Update title',
      files: [
        {
          path: '/src/App.tsx',
          before: 'export const title = "old";',
          after: 'export const title = "new";'
        }
      ]
    };

    const res = validatePatch(patch, files);
    expect(res.valid).toBe(true);
    expect(res.errors.length).toBe(0);
  });

  it('B. valid multi-file patch', () => {
    const files: Record<string, ProjectFile> = {
      '/src/App.tsx': makeProjectFile('proj', '/src/App.tsx', 'export const App = () => null;'),
      '/src/config.ts': makeProjectFile('proj', '/src/config.ts', 'export const api = "http://api";')
    };

    const patch: Patch = {
      id: 'patch-2',
      summary: 'Multi-file patch',
      files: [
        { path: '/src/App.tsx', before: 'export const App = () => null;', after: 'export const App = () => <div>App</div>;' },
        { path: '/src/config.ts', before: 'export const api = "http://api";', after: 'export const api = "https://api";' }
      ]
    };

    const res = validatePatch(patch, files);
    expect(res.valid).toBe(true);
    expect(res.errors.length).toBe(0);
  });

  it('C. stale before-content', () => {
    const files: Record<string, ProjectFile> = {
      '/src/App.tsx': makeProjectFile('proj', '/src/App.tsx', 'const currentVersion = 2;')
    };

    const stalePatch: Patch = {
      id: 'patch-3',
      summary: 'Stale patch based on version 1',
      files: [
        {
          path: '/src/App.tsx',
          before: 'const currentVersion = 1;',
          after: 'const currentVersion = 3;'
        }
      ]
    };

    const res = validatePatch(stalePatch, files);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('does not match patch baseline exactly'))).toBe(true);
    expect(res.structuredErrors.some(e => e.rule === 'STALE_BEFORE_CONTENT')).toBe(true);
  });

  it('D. changed file after diff generation', () => {
    const initialContent = 'export function calculateTax(amt: number) { return amt * 0.1; }';
    const modifiedContent = 'export function calculateTax(amt: number) { return amt * 0.15; }';

    const files: Record<string, ProjectFile> = {
      '/src/tax.ts': makeProjectFile('proj', '/src/tax.ts', modifiedContent)
    };

    // Patch was generated against initialContent
    const patch: Patch = {
      id: 'patch-4',
      summary: 'Patch from earlier diff',
      files: [
        {
          path: '/src/tax.ts',
          before: initialContent,
          after: 'export function calculateTax(amt: number) { return amt * 0.2; }'
        }
      ]
    };

    const res = validatePatch(patch, files);
    expect(res.valid).toBe(false);
    expect(res.structuredErrors[0].rule).toBe('STALE_BEFORE_CONTENT');
  });

  it('E. new file already exists', () => {
    const files: Record<string, ProjectFile> = {
      '/src/components/Header.tsx': makeProjectFile('proj', '/src/components/Header.tsx', 'export const Header = () => null;')
    };

    const newFilePatch: Patch = {
      id: 'patch-5',
      summary: 'Attempt to create new file that already exists',
      files: [
        {
          path: '/src/components/Header.tsx',
          before: '',
          after: 'export const Header = () => <header>New</header>;'
        }
      ]
    };

    const res = validatePatch(newFilePatch, files);
    expect(res.valid).toBe(false);
    expect(res.structuredErrors.some(e => e.rule === 'FILE_ALREADY_EXISTS')).toBe(true);
  });

  it('F. missing target file', () => {
    const files: Record<string, ProjectFile> = {
      '/src/App.tsx': makeProjectFile('proj', '/src/App.tsx', 'content')
    };

    const patch: Patch = {
      id: 'patch-6',
      summary: 'Target missing file',
      files: [
        {
          path: '/src/non_existent.ts',
          before: 'some content',
          after: 'new content'
        }
      ]
    };

    const res = validatePatch(patch, files);
    expect(res.valid).toBe(false);
    expect(res.structuredErrors.some(e => e.rule === 'TARGET_FILE_MISSING')).toBe(true);
  });

  it('G. path traversal', () => {
    const files: Record<string, ProjectFile> = {
      '/src/App.tsx': makeProjectFile('proj', '/src/App.tsx', 'content')
    };

    const patch: Patch = {
      id: 'patch-7',
      summary: 'Traversal attack',
      files: [
        {
          path: '../outside.ts',
          before: '',
          after: 'malicious'
        }
      ]
    };

    const res = validatePatch(patch, files);
    expect(res.valid).toBe(false);
    expect(res.structuredErrors.some(e => e.rule === 'INVALID_PATH')).toBe(true);
  });

  it('H. absolute path', () => {
    const files: Record<string, ProjectFile> = {};

    const patch: Patch = {
      id: 'patch-8',
      summary: 'Absolute OS path attack',
      files: [
        {
          path: 'C:\\Windows\\System32\\cmd.exe',
          before: '',
          after: 'evil'
        },
        {
          path: '/etc/shadow',
          before: '',
          after: 'evil'
        }
      ]
    };

    const res = validatePatch(patch, files);
    expect(res.valid).toBe(false);
    expect(res.structuredErrors.length).toBe(2);
    expect(res.structuredErrors.every(e => e.rule === 'INVALID_PATH')).toBe(true);
  });

  it('I. invalid path (empty, whitespace, null bytes)', () => {
    const files: Record<string, ProjectFile> = {};

    const patch: Patch = {
      id: 'patch-9',
      summary: 'Invalid path',
      files: [
        {
          path: '   ',
          before: '',
          after: 'test'
        }
      ]
    };

    const res = validatePatch(patch, files);
    expect(res.valid).toBe(false);
    expect(res.structuredErrors.some(e => e.rule === 'INVALID_PATH')).toBe(true);
  });

  it('J. duplicate patch paths', () => {
    const files: Record<string, ProjectFile> = {
      '/src/App.tsx': makeProjectFile('proj', '/src/App.tsx', 'orig')
    };

    const patch: Patch = {
      id: 'patch-10',
      summary: 'Duplicate paths',
      files: [
        { path: '/src/App.tsx', before: 'orig', after: 'first change' },
        { path: '/src/App.tsx', before: 'first change', after: 'second change' }
      ]
    };

    const res = validatePatch(patch, files);
    expect(res.valid).toBe(false);
    expect(res.structuredErrors.some(e => e.rule === 'DUPLICATE_PATH')).toBe(true);
  });

  it('K. mixed valid + invalid multi-file patch must apply NOTHING', async () => {
    const projId = 'proj-atomic-check';
    const originalApp = 'export const App = () => <div>Original App</div>;';
    await vfsManager.writeFile(projId, '/src/App.tsx', originalApp);

    const mixedPatch: Patch = {
      id: 'patch-11',
      summary: 'Mixed patch with 1 valid file and 1 invalid traversal file',
      files: [
        {
          path: '/src/App.tsx',
          before: originalApp,
          after: 'export const App = () => <div>Mutated App</div>;'
        },
        {
          path: '../escape.ts',
          before: '',
          after: 'malicious'
        }
      ]
    };

    const verifySpy = vi.spyOn(verificationService, 'runFullVerification');

    const result = await repairLoopEngine.applyPatchAndVerify(projId, mixedPatch);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('Patch validation failed');
    expect(verifySpy).not.toHaveBeenCalled();

    // Verify VFS was NEVER mutated for the valid file
    expect(vfsManager.getFile(projId, '/src/App.tsx')?.content).toBe(originalApp);
  });

  it('L. nested traversal (src/../../outside.ts) rejected with INVALID_PATH', () => {
    const files: Record<string, ProjectFile> = {};
    const patch: Patch = {
      id: 'patch-nested-traversal',
      summary: 'Nested traversal attack',
      files: [
        {
          path: 'src/../../outside.ts',
          before: '',
          after: 'malicious'
        }
      ]
    };

    const res = validatePatch(patch, files);
    expect(res.valid).toBe(false);
    expect(res.structuredErrors.some(e => e.rule === 'INVALID_PATH')).toBe(true);
  });

  it('M. absolute POSIX system path (/etc/passwd) rejected with INVALID_PATH', () => {
    const files: Record<string, ProjectFile> = {};
    const patch: Patch = {
      id: 'patch-posix-passwd',
      summary: 'POSIX system file attack',
      files: [
        {
          path: '/etc/passwd',
          before: '',
          after: 'root::0:0:root:/root:/bin/bash'
        }
      ]
    };

    const res = validatePatch(patch, files);
    expect(res.valid).toBe(false);
    expect(res.structuredErrors.some(e => e.rule === 'INVALID_PATH')).toBe(true);
  });

  it('N. UNC network path (\\\\server\\share\\file.ts) rejected with INVALID_PATH regardless of new or existing', () => {
    const files: Record<string, ProjectFile> = {
      '/src/App.tsx': makeProjectFile('proj', '/src/App.tsx', 'valid')
    };
    
    // As existing file
    const patchExisting: Patch = {
      id: 'patch-unc-existing',
      summary: 'UNC network path attack (existing)',
      files: [{ path: '\\\\server\\share\\file.ts', before: 'something', after: 'evil' }]
    };
    const resExisting = validatePatch(patchExisting, files);
    expect(resExisting.valid).toBe(false);
    expect(resExisting.structuredErrors.some(e => e.rule === 'INVALID_PATH')).toBe(true);

    // As new file
    const patchNew: Patch = {
      id: 'patch-unc-new',
      summary: 'UNC network path attack (new)',
      files: [{ path: '\\\\server\\share\\file.ts', before: '', after: 'evil' }]
    };
    const resNew = validatePatch(patchNew, files);
    expect(resNew.valid).toBe(false);
    expect(resNew.structuredErrors.some(e => e.rule === 'INVALID_PATH')).toBe(true);
  });

  it('O. forward-slash network path (//server/share/file.ts) rejected with INVALID_PATH regardless of new or existing', () => {
    const files: Record<string, ProjectFile> = {};
    const patch: Patch = {
      id: 'patch-double-slash',
      summary: 'Double slash network path attack',
      files: [
        { path: '//server/share/file.ts', before: '', after: 'evil' },
        { path: '//server/share/existing.ts', before: 'foo', after: 'evil' }
      ]
    };
    const res = validatePatch(patch, files);
    expect(res.valid).toBe(false);
    expect(res.structuredErrors.every(e => e.rule === 'INVALID_PATH')).toBe(true);
  });

  it('P. embedded null-byte in path rejected with INVALID_PATH regardless of new or existing', () => {
    const files: Record<string, ProjectFile> = {};
    const patch: Patch = {
      id: 'patch-null-byte',
      summary: 'Null byte injection attack',
      files: [
        { path: '/src/evil\0.ts', before: '', after: 'malicious' },
        { path: '/src/nested/\0/evil.ts', before: 'old', after: 'malicious' }
      ]
    };
    const res = validatePatch(patch, files);
    expect(res.valid).toBe(false);
    expect(res.structuredErrors.every(e => e.rule === 'INVALID_PATH')).toBe(true);
  });

  it('Q. valid new file creation patch passes validation', () => {
    const files: Record<string, ProjectFile> = {
      '/src/App.tsx': makeProjectFile('proj', '/src/App.tsx', 'export default () => null;')
    };
    const patch: Patch = {
      id: 'patch-new-valid',
      summary: 'Add brand new helper module',
      files: [
        { path: '/src/utils/calc.ts', before: '', after: 'export const add = (a: number, b: number) => a + b;' }
      ]
    };
    const res = validatePatch(patch, files);
    expect(res.valid).toBe(true);
    expect(res.errors.length).toBe(0);
  });
});

