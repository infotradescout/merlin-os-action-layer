export type MealScoutDetectedType =
  | 'profile_screenshot'
  | 'menu'
  | 'logo'
  | 'schedule'
  | 'social'
  | 'unknown';

export type MealScoutExtractedMenuItem = {
  name: string;
  price?: string;
  description?: string;
};

export type MealScoutExtractedSignals = {
  truckName?: string;
  phone?: string;
  email?: string;
  website?: string;
  facebook?: string;
  instagram?: string;
  cityArea?: string;
  cuisine?: string;
  menuItems?: MealScoutExtractedMenuItem[];
};

export type MealScoutEvidenceFile = {
  fileId: string;
  fileName: string;
  drivePath: string;
  sourceFolder: string;
  detectedType: MealScoutDetectedType;
  extractedSignals: MealScoutExtractedSignals;
  confidence: number;
};

export type MealScoutEvidenceCluster = {
  clusterId: string;
  files: MealScoutEvidenceFile[];
  likelyTruckName?: string;
  matchSignals: string[];
  confidence: number;
  reviewStatus: 'ready_for_draft' | 'uncertain_match' | 'missing_required' | 'duplicate_possible';
};

export type MealScoutExistingProfileHint = {
  existingProfileId: string;
  truckName?: string;
  phone?: string;
  email?: string;
  website?: string;
  facebook?: string;
  instagram?: string;
  cityArea?: string;
};

function normalizeText(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function normalizePhone(value: string | undefined): string {
  return (value || '').replace(/[^0-9]/g, '');
}

function normalizeHandle(value: string | undefined): string {
  return normalizeText(value).replace(/^@/, '');
}

function compactName(value: string | undefined): string {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function similarName(left: string | undefined, right: string | undefined): boolean {
  const a = compactName(left);
  const b = compactName(right);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const leftTokens = normalizeText(left).split(/[^a-z0-9]+/).filter(Boolean);
  const rightTokens = normalizeText(right).split(/[^a-z0-9]+/).filter(Boolean);
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.includes(token)) overlap += 1;
  }
  return overlap >= 2;
}

function menuOverlap(left: MealScoutExtractedMenuItem[] | undefined, right: MealScoutExtractedMenuItem[] | undefined): boolean {
  const a = (left || []).map((item) => compactName(item.name)).filter(Boolean);
  const b = new Set((right || []).map((item) => compactName(item.name)).filter(Boolean));
  for (const item of a) {
    if (b.has(item)) return true;
  }
  return false;
}

export function classifyMealScoutDetectedType(input: {
  sourceFolder?: string;
  extractedSignals?: MealScoutExtractedSignals;
  visualHints?: { hasLogo?: boolean; hasMenuLayout?: boolean; hasHoursGrid?: boolean; hasSocialUi?: boolean };
}): { detectedType: MealScoutDetectedType; confidence: number } {
  const folder = normalizeText(input.sourceFolder);
  const signals = input.extractedSignals || {};
  const hints = input.visualHints || {};

  if (folder.includes('/logos') || folder.endsWith('logos') || hints.hasLogo) {
    return { detectedType: 'logo', confidence: 0.85 };
  }
  if (folder.includes('/menus') || folder.endsWith('menus') || hints.hasMenuLayout || (signals.menuItems || []).length > 0) {
    return { detectedType: 'menu', confidence: 0.9 };
  }
  if (hints.hasHoursGrid) {
    return { detectedType: 'schedule', confidence: 0.8 };
  }
  if (hints.hasSocialUi || signals.facebook || signals.instagram) {
    return { detectedType: 'social', confidence: 0.78 };
  }
  if (signals.truckName || signals.phone || signals.email || signals.website || signals.cityArea || signals.cuisine) {
    return { detectedType: 'profile_screenshot', confidence: 0.75 };
  }
  return { detectedType: 'unknown', confidence: 0.4 };
}

function evaluatePair(left: MealScoutEvidenceFile, right: MealScoutEvidenceFile): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  if (normalizePhone(left.extractedSignals.phone) && normalizePhone(left.extractedSignals.phone) === normalizePhone(right.extractedSignals.phone)) {
    signals.push('phone_match');
    score += 1;
  }
  if (normalizeText(left.extractedSignals.email) && normalizeText(left.extractedSignals.email) === normalizeText(right.extractedSignals.email)) {
    signals.push('email_match');
    score += 1;
  }
  if (normalizeText(left.extractedSignals.website) && normalizeText(left.extractedSignals.website) === normalizeText(right.extractedSignals.website)) {
    signals.push('website_match');
    score += 1;
  }
  if (
    normalizeHandle(left.extractedSignals.facebook) &&
    normalizeHandle(left.extractedSignals.facebook) === normalizeHandle(right.extractedSignals.facebook)
  ) {
    signals.push('facebook_match');
    score += 1;
  }
  if (
    normalizeHandle(left.extractedSignals.instagram) &&
    normalizeHandle(left.extractedSignals.instagram) === normalizeHandle(right.extractedSignals.instagram)
  ) {
    signals.push('instagram_match');
    score += 1;
  }

  if (
    similarName(left.extractedSignals.truckName, right.extractedSignals.truckName) &&
    normalizeText(left.extractedSignals.cityArea) &&
    normalizeText(left.extractedSignals.cityArea) === normalizeText(right.extractedSignals.cityArea)
  ) {
    signals.push('name_city_match');
    score += 0.7;
  }

  if (menuOverlap(left.extractedSignals.menuItems, right.extractedSignals.menuItems)) {
    signals.push('menu_overlap');
    score += 0.4;
  }

  return { score, signals };
}

function aggregateClusterSignals(files: MealScoutEvidenceFile[]): { truckName?: string; confidence: number; matchSignals: string[] } {
  const names = new Map<string, number>();
  const signalSet = new Set<string>();
  for (const file of files) {
    const name = normalizeText(file.extractedSignals.truckName);
    if (name) {
      names.set(name, (names.get(name) || 0) + 1);
    }
  }
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const pair = evaluatePair(files[i], files[j]);
      for (const signal of pair.signals) signalSet.add(signal);
    }
  }

  let likelyTruckName: string | undefined;
  let max = 0;
  for (const [name, count] of names.entries()) {
    if (count > max) {
      max = count;
      likelyTruckName = name;
    }
  }

  const avgConfidence = files.reduce((acc, file) => acc + file.confidence, 0) / Math.max(1, files.length);
  return {
    truckName: likelyTruckName,
    confidence: Number(Math.max(0, Math.min(1, avgConfidence)).toFixed(2)),
    matchSignals: Array.from(signalSet)
  };
}

function deriveClusterReviewStatus(cluster: MealScoutEvidenceCluster, existingProfiles: MealScoutExistingProfileHint[]): MealScoutEvidenceCluster['reviewStatus'] {
  const hasTruckName = cluster.files.some((file) => Boolean(file.extractedSignals.truckName));
  const hasContact = cluster.files.some((file) => Boolean(file.extractedSignals.phone || file.extractedSignals.email));
  const hasCity = cluster.files.some((file) => Boolean(file.extractedSignals.cityArea));
  const hasCuisine = cluster.files.some((file) => Boolean(file.extractedSignals.cuisine));
  const hasMenu = cluster.files.some((file) => (file.extractedSignals.menuItems || []).length > 0);
  const hasUnknownOnly = cluster.files.every((file) => file.detectedType === 'unknown');

  if (!hasTruckName || !hasContact || !hasCity || !hasCuisine || !hasMenu) {
    return 'missing_required';
  }

  const hasDuplicate = existingProfiles.some((profile) => {
    const strong = cluster.files.some((file) =>
      (normalizePhone(file.extractedSignals.phone) && normalizePhone(file.extractedSignals.phone) === normalizePhone(profile.phone)) ||
      (normalizeText(file.extractedSignals.email) && normalizeText(file.extractedSignals.email) === normalizeText(profile.email)) ||
      (normalizeText(file.extractedSignals.website) && normalizeText(file.extractedSignals.website) === normalizeText(profile.website)) ||
      (normalizeHandle(file.extractedSignals.facebook) && normalizeHandle(file.extractedSignals.facebook) === normalizeHandle(profile.facebook)) ||
      (normalizeHandle(file.extractedSignals.instagram) && normalizeHandle(file.extractedSignals.instagram) === normalizeHandle(profile.instagram))
    );
    if (strong) return true;
    return cluster.files.some(
      (file) =>
        similarName(file.extractedSignals.truckName, profile.truckName) &&
        normalizeText(file.extractedSignals.cityArea) &&
        normalizeText(file.extractedSignals.cityArea) === normalizeText(profile.cityArea)
    );
  });

  if (hasDuplicate) return 'duplicate_possible';
  if (hasUnknownOnly || cluster.confidence < 0.6) return 'uncertain_match';
  return 'ready_for_draft';
}

export function clusterMealScoutEvidenceFiles(
  files: MealScoutEvidenceFile[],
  existingProfiles: MealScoutExistingProfileHint[] = []
): MealScoutEvidenceCluster[] {
  const unassigned = [...files];
  const clusters: MealScoutEvidenceCluster[] = [];

  while (unassigned.length > 0) {
    const seed = unassigned.shift()!;
    const clusterFiles: MealScoutEvidenceFile[] = [seed];

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = unassigned.length - 1; i >= 0; i -= 1) {
        const candidate = unassigned[i];
        const links = clusterFiles.map((existing) => evaluatePair(existing, candidate));
        const bestScore = links.reduce((acc, item) => Math.max(acc, item.score), 0);
        if (bestScore >= 0.75) {
          clusterFiles.push(candidate);
          unassigned.splice(i, 1);
          changed = true;
        }
      }
    }

    const aggregate = aggregateClusterSignals(clusterFiles);
    const cluster: MealScoutEvidenceCluster = {
      clusterId: `cluster-${clusters.length + 1}`,
      files: clusterFiles,
      likelyTruckName: aggregate.truckName,
      matchSignals: aggregate.matchSignals,
      confidence: aggregate.confidence,
      reviewStatus: 'uncertain_match'
    };
    cluster.reviewStatus = deriveClusterReviewStatus(cluster, existingProfiles);
    clusters.push(cluster);
  }

  return clusters;
}

export function createMealScoutEvidenceFile(input: {
  fileId: string;
  fileName: string;
  drivePath: string;
  sourceFolder: string;
  extractedSignals?: MealScoutExtractedSignals;
  visualHints?: { hasLogo?: boolean; hasMenuLayout?: boolean; hasHoursGrid?: boolean; hasSocialUi?: boolean };
  detectedType?: MealScoutDetectedType;
  confidence?: number;
}): MealScoutEvidenceFile {
  const auto = classifyMealScoutDetectedType({
    sourceFolder: input.sourceFolder,
    extractedSignals: input.extractedSignals,
    visualHints: input.visualHints
  });

  return {
    fileId: input.fileId,
    fileName: input.fileName,
    drivePath: input.drivePath,
    sourceFolder: input.sourceFolder,
    detectedType: input.detectedType || auto.detectedType,
    extractedSignals: input.extractedSignals || {},
    confidence: Number(Math.max(0, Math.min(1, input.confidence ?? auto.confidence)).toFixed(2))
  };
}
