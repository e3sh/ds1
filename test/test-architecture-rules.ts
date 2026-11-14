import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';

console.log('--- Architecture & Dependency Rules Verification ---');

function getTsFiles(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getTsFiles(fullPath));
    } else if (file.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

const baseDir = path.resolve(process.cwd());

const forbiddenKeywordsInLogic = [
  'window',
  'document',
  'HTMLElement',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D',
  'AudioContext',
  'webkitAudioContext',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'sessionStorage',
  'navigator',
];

const forbiddenImportsInLogic = [
  '/view/',
  '/audio/',
  'src/view',
  'src/audio',
  'CanvasRenderer',
  'DOMUIManager',
  'PSGAudio',
  'CombatEffectManager',
  'HUDRenderer',
  'MonsterGraphics',
  'TileGraphics',
];

// Test 1: Models layer purity
{
  console.log('Testing 1: Pure Headless verification for src/models/...');
  const modelFiles = getTsFiles(path.join(baseDir, 'src/models'));
  assert.ok(modelFiles.length > 0, 'Model files must exist');

  for (const file of modelFiles) {
    const relPath = path.relative(baseDir, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

      for (const forbiddenImport of forbiddenImportsInLogic) {
        assert.ok(
          !line.includes(forbiddenImport),
          `[Violation] ${relPath}:${i + 1} forbidden view/audio import detected: "${trimmed}"`
        );
      }

      for (const kw of forbiddenKeywordsInLogic) {
        const regex = new RegExp(`\\b${kw}\\b`);
        assert.ok(
          !regex.test(line),
          `[Violation] ${relPath}:${i + 1} DOM/Browser keyword "${kw}" detected in model layer: "${trimmed}"`
        );
      }
    }
  }
  console.log(`✓ 1. All ${modelFiles.length} model files are 100% pure headless & UI-free.`);
}

// Test 2: Systems layer purity
{
  console.log('Testing 2: Pure Headless verification for src/systems/...');
  const systemFiles = getTsFiles(path.join(baseDir, 'src/systems'));
  assert.ok(systemFiles.length > 0, 'System files must exist');

  for (const file of systemFiles) {
    const relPath = path.relative(baseDir, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

      for (const forbiddenImport of forbiddenImportsInLogic) {
        assert.ok(
          !line.includes(forbiddenImport),
          `[Violation] ${relPath}:${i + 1} forbidden view/audio import detected: "${trimmed}"`
        );
      }

      for (const kw of forbiddenKeywordsInLogic) {
        const regex = new RegExp(`\\b${kw}\\b`);
        assert.ok(
          !regex.test(line),
          `[Violation] ${relPath}:${i + 1} DOM/Browser keyword "${kw}" detected in system layer: "${trimmed}"`
        );
      }
    }
  }
  console.log(`✓ 2. All ${systemFiles.length} system files are 100% pure headless & UI-free.`);
}

// Test 3: Config layer purity
{
  console.log('Testing 3: Pure Headless verification for src/config/...');
  const configFiles = getTsFiles(path.join(baseDir, 'src/config'));
  assert.ok(configFiles.length > 0, 'Config files must exist');

  for (const file of configFiles) {
    const relPath = path.relative(baseDir, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

      for (const forbiddenImport of forbiddenImportsInLogic) {
        assert.ok(
          !line.includes(forbiddenImport),
          `[Violation] ${relPath}:${i + 1} forbidden view/audio import detected: "${trimmed}"`
        );
      }

      for (const kw of forbiddenKeywordsInLogic) {
        const regex = new RegExp(`\\b${kw}\\b`);
        assert.ok(
          !regex.test(line),
          `[Violation] ${relPath}:${i + 1} DOM/Browser keyword "${kw}" detected in config layer: "${trimmed}"`
        );
      }
    }
  }
  console.log(`✓ 3. All ${configFiles.length} config files are 100% pure headless & UI-free.`);
}

// Test 3.5: AI & Simulation layer purity
{
  console.log('Testing 3.5: Pure Headless verification for src/ai/ and src/simulation/...');
  const aiFiles = fs.existsSync(path.join(baseDir, 'src/ai')) ? getTsFiles(path.join(baseDir, 'src/ai')) : [];
  const simFiles = fs.existsSync(path.join(baseDir, 'src/simulation')) ? getTsFiles(path.join(baseDir, 'src/simulation')) : [];
  const targetFiles = [...aiFiles, ...simFiles];
  assert.ok(targetFiles.length > 0, 'AI and Simulation files must exist');

  for (const file of targetFiles) {
    const relPath = path.relative(baseDir, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

      for (const forbiddenImport of forbiddenImportsInLogic) {
        assert.ok(
          !line.includes(forbiddenImport),
          `[Violation] ${relPath}:${i + 1} forbidden view/audio import detected: "${trimmed}"`
        );
      }

      for (const kw of forbiddenKeywordsInLogic) {
        const regex = new RegExp(`\\b${kw}\\b`);
        assert.ok(
          !regex.test(line),
          `[Violation] ${relPath}:${i + 1} DOM/Browser keyword "${kw}" detected in AI/Simulation layer: "${trimmed}"`
        );
      }
    }
  }
  console.log(`✓ 3.5. All ${targetFiles.length} AI and Simulation files are 100% pure headless & UI-free.`);
}

// Test 4: One-way dependency flow verification (UI/View depends on Logic, never reversed)
{
  console.log('Testing 4: Unidirectional dependency flow verification...');
  const viewFiles = getTsFiles(path.join(baseDir, 'src/view'));
  assert.ok(viewFiles.length > 0, 'View files must exist');

  // Verify that views do not import from GameEngine directly (passive view principle)
  for (const file of viewFiles) {
    const relPath = path.relative(baseDir, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

      assert.ok(
        !line.includes('GameEngine'),
        `[Violation] ${relPath}:${i + 1} View layer should not directly depend on GameEngine: "${trimmed}"`
      );
    }
  }
  console.log('✓ 4. Passive View design verified: No view components depend on GameEngine.');
}

// 7. 戦略層（src/ai/strategy）からの全マップ走査ループ禁止ルール (Behavior-style raw loop 根絶)
{
  const strategyDir = path.join(baseDir, 'src', 'ai', 'strategy');
  const strategyFiles = getTsFiles(strategyDir);
  const violations: string[] = [];

  for (const filePath of strategyFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const withoutBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, match =>
      match.replace(/[^\n]/g, '')
    );
    const lines = withoutBlockComments.split(/\r?\n/);
    lines.forEach((line, idx) => {
      const activeCode = line.replace(/\/\/.*$/, '');
      if (/\bfor\s*\(\s*let\s+[xy]\b/.test(activeCode)) {
        const rel = path.relative(baseDir, filePath).replace(/\\/g, '/');
        violations.push(`${rel}:${idx + 1}: ${activeCode.trim()}`);
      }
    });
  }

  assert.strictEqual(
    violations.length,
    0,
    `Strategy layer must not contain raw map scan loops (for let x/y):\n${violations.join('\n')}`
  );
  console.log('✓ 7. Strategy layer purity verified: No raw map loops (for let x/y) in src/ai/strategy.');
}

console.log('--- ✓ All Architecture & Dependency Rules Passed Successfully! ---');
