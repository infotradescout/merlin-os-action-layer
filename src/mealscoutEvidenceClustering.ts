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
  const hasProfileSignals = Boolean(
    signals.truckName || signals.phone || signals.email || signals.website || signals.cityArea || signals.cuisine
  );

  if (folder.includes('/logos') || folder.endsWith('logos') || hints.hasLogo) {
    return { detectedType: 'logo', confidence: 0.85 };
  }
  if (folder.includes('/menus') || folder.endsWith('menus') || hints.hasMenuLayout || (signals.menuItems || []).length > 0) {
    return { detectedType: 'menu', confidence: 0.9 };
  }
  if (hints.hasHoursGrid) {
    return { detectedType: 'schedule', confidence: 0.8 };
  }
  if (hasProfileSignals) {
    return { detectedType: 'profile_screenshot', confidence: 0.8 };
  }
  if (hints.hasSocialUi || signals.facebook || signals.instagram) {
    return { detectedType: 'social', confidence: 0.78 };
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
  if (
    normalizeText(left.extractedSignals.truckName) &&
    normalizeText(left.extractedSignals.truckName) === normalizeText(right.extractedSignals.truckName)
  ) {
    signals.push('truck_name_exact_match');
    score += 0.95;
  } else if (similarName(left.extractedSignals.truckName, right.extractedSignals.truckName)) {
    signals.push('truck_name_similar');
    score += 0.55;
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
  const singleton = cluster.files[0];
  const singletonHasStrongIdentity =
    cluster.files.length === 1 &&
    Boolean(
      normalizePhone(singleton?.extractedSignals.phone) ||
        normalizeText(singleton?.extractedSignals.email) ||
        normalizeText(singleton?.extractedSignals.website) ||
        normalizeHandle(singleton?.extractedSignals.facebook) ||
        normalizeHandle(singleton?.extractedSignals.instagram) ||
        normalizeText(singleton?.extractedSignals.truckName)
    );

  if (
    cluster.files.length === 1 &&
    (cluster.files[0].detectedType === 'logo' || cluster.files[0].detectedType === 'unknown' || cluster.files[0].detectedType === 'menu') &&
    !singletonHasStrongIdentity
  ) {
    return 'uncertain_match';
  }

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

function hasStrongIdentity(file: MealScoutEvidenceFile): boolean {
  return Boolean(
    normalizePhone(file.extractedSignals.phone) ||
      normalizeText(file.extractedSignals.email) ||
      normalizeText(file.extractedSignals.website) ||
      normalizeHandle(file.extractedSignals.facebook) ||
      normalizeHandle(file.extractedSignals.instagram) ||
      normalizeText(file.extractedSignals.truckName)
  );
}

function hasConflictingIdentity(candidate: MealScoutEvidenceFile, anchor: MealScoutEvidenceFile): boolean {
  const candidatePhone = normalizePhone(candidate.extractedSignals.phone);
  const anchorPhone = normalizePhone(anchor.extractedSignals.phone);
  if (candidatePhone && anchorPhone && candidatePhone !== anchorPhone) return true;

  const candidateEmail = normalizeText(candidate.extractedSignals.email);
  const anchorEmail = normalizeText(anchor.extractedSignals.email);
  if (candidateEmail && anchorEmail && candidateEmail !== anchorEmail) return true;

  const candidateSite = normalizeText(candidate.extractedSignals.website);
  const anchorSite = normalizeText(anchor.extractedSignals.website);
  if (candidateSite && anchorSite && candidateSite !== anchorSite) return true;

  const candidateName = normalizeText(candidate.extractedSignals.truckName);
  const anchorName = normalizeText(anchor.extractedSignals.truckName);
  if (candidateName && anchorName && !similarName(candidateName, anchorName)) return true;

  return false;
}

function bridgeAuxiliaryFiles(
  clusters: MealScoutEvidenceCluster[],
  existingProfiles: MealScoutExistingProfileHint[]
): MealScoutEvidenceCluster[] {
  if (clusters.length <= 1) return clusters;

  const anchorCandidates = clusters.filter((cluster) =>
    cluster.files.some((file) => file.detectedType === 'profile_screenshot' && hasStrongIdentity(file))
  );

  if (anchorCandidates.length !== 1) return clusters;
  const anchor = anchorCandidates[0];
  const anchorStrong = anchor.files.find((file) => file.detectedType === 'profile_screenshot' && hasStrongIdentity(file));
  if (!anchorStrong) return clusters;

  const keep: MealScoutEvidenceCluster[] = [];
  for (const cluster of clusters) {
    if (cluster.clusterId === anchor.clusterId) {
      keep.push(cluster);
      continue;
    }

    if (cluster.files.length !== 1) {
      keep.push(cluster);
      continue;
    }

    const single = cluster.files[0];
    const auxiliaryType = single.detectedType === 'menu' || single.detectedType === 'logo' || single.detectedType === 'schedule';
    if (!auxiliaryType) {
      keep.push(cluster);
      continue;
    }

    const candidateHasStrong = hasStrongIdentity(single);
    const candidateName = normalizeText(single.extractedSignals.truckName);
    const anchorName = normalizeText(anchorStrong.extractedSignals.truckName);
    const nameAligned = candidateName && anchorName && similarName(candidateName, anchorName);
    const safeToAttach =
      !hasConflictingIdentity(single, anchorStrong) &&
      (nameAligned || (!candidateHasStrong && (single.extractedSignals.menuItems || []).length > 0) || single.detectedType === 'logo');

    if (safeToAttach) {
      anchor.files.push(single);
      anchor.matchSignals = Array.from(new Set([...anchor.matchSignals, 'auxiliary_bridge']));
    } else {
      keep.push(cluster);
    }
  }

  const refreshed = keep.map((cluster, index) => {
    const aggregate = aggregateClusterSignals(cluster.files);
    return {
      ...cluster,
      clusterId: `cluster-${index + 1}`,
      likelyTruckName: aggregate.truckName,
      confidence: aggregate.confidence,
      matchSignals: Array.from(new Set([...cluster.matchSignals, ...aggregate.matchSignals]))
    };
  });

  for (const cluster of refreshed) {
    cluster.reviewStatus = deriveClusterReviewStatus(cluster, existingProfiles);
  }

  return refreshed;
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

  return bridgeAuxiliaryFiles(clusters, existingProfiles);
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
