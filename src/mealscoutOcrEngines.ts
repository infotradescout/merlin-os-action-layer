import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export type MealScoutOcrCandidateStatus =
  | 'AVAILABLE'
  | 'TESSERACT_NOT_FOUND'
  | 'PYTHON_NOT_FOUND'
  | 'PADDLEOCR_NOT_INSTALLED'
  | 'EASYOCR_NOT_INSTALLED';

export type MealScoutOcrEngineCandidate = {
  engine: 'tesseract' | 'paddleocr' | 'easyocr';
  status: MealScoutOcrCandidateStatus;
};

export type MealScoutDetectedEngines = {
  candidates: MealScoutOcrEngineCandidate[];
  selectedEngine: 'tesseract' | 'paddleocr' | 'easyocr' | 'none';
  tesseractBinary?: string;
};

function hasCommand(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function resolveTesseractBinary(): string | undefined {
  const explicit = process.env.TESSERACT_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const windowsDefault = 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
  if (existsSync(windowsDefault)) return windowsDefault;
  const windowsLocalUser = 'C:\\Users\\flavo\\AppData\\Local\\Programs\\Tesseract-OCR\\tesseract.exe';
  if (existsSync(windowsLocalUser)) return windowsLocalUser;
  if (hasCommand('where.exe', ['tesseract']) || hasCommand('command', ['-v', 'tesseract'])) {
    if (hasCommand('tesseract', ['--version'])) return 'tesseract';
  }
  return undefined;
}

function resolvePythonCommand(): string | undefined {
  if (hasCommand('python', ['--version'])) return 'python';
  if (hasCommand('py', ['--version'])) return 'py';
  return undefined;
}

function hasPythonModule(pythonCommand: string, moduleName: string): boolean {
  try {
    execFileSync(pythonCommand, ['-c', `import ${moduleName}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
}

export function detectMealScoutOcrEngines(): MealScoutDetectedEngines {
  const candidates: MealScoutOcrEngineCandidate[] = [];
  const tesseractBinary = resolveTesseractBinary();
  candidates.push({
    engine: 'tesseract',
    status: tesseractBinary ? 'AVAILABLE' : 'TESSERACT_NOT_FOUND'
  });

  const pythonCommand = resolvePythonCommand();
  if (!pythonCommand) {
    candidates.push({ engine: 'paddleocr', status: 'PYTHON_NOT_FOUND' });
    candidates.push({ engine: 'easyocr', status: 'PYTHON_NOT_FOUND' });
  } else {
    candidates.push({
      engine: 'paddleocr',
      status: hasPythonModule(pythonCommand, 'paddleocr') ? 'AVAILABLE' : 'PADDLEOCR_NOT_INSTALLED'
    });
    candidates.push({
      engine: 'easyocr',
      status: hasPythonModule(pythonCommand, 'easyocr') ? 'AVAILABLE' : 'EASYOCR_NOT_INSTALLED'
    });
  }

  const selectedEngine = tesseractBinary
    ? 'tesseract'
    : candidates.find((candidate) => candidate.status === 'AVAILABLE')?.engine || 'none';

  return {
    candidates,
    selectedEngine,
    tesseractBinary
  };
}
