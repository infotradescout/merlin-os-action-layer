import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildThomasApprovedDraftExport,
  renderThomasApprovedDraftExportMarkdown,
  type ThomasAnnotatedApprovalSweepItem,
  type ThomasFinalDecision
} from '../src/mealscoutThomasApprovedDraftExport.js';
import type { ThomasApprovalSweep } from '../src/mealscoutThomasApprovalSweep.js';

const THOMAS_DECISIONS = new Set<ThomasFinalDecision>([
  'approve_draft',
  'hold_for_more_evidence',
  'wrong_business_name',
  'duplicate_existing_profile',
  'quarantine'
]);

function parseArgs(argv: string[]): {
  approvalSweepJson: string;
  outputJson: string;
  outputMarkdown: string;
  decisionAll?: ThomasFinalDecision;
} {
  const artifactDir = resolve(process.cwd(), 'artifacts/mealscout-draft-profile-packets');
  const parsed = {
    approvalSweepJson: resolve(artifactDir, 'thomas-clean-candidate-approval-sweep.json'),
    outputJson: resolve(artifactDir, 'thomas-approved-draft-export.json'),
    outputMarkdown: resolve(artifactDir, 'thomas-approved-draft-export.md'),
    decisionAll: undefined as ThomasFinalDecision | undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1] || '';
    if (arg === '--approval-sweep-json') parsed.approvalSweepJson = resolve(process.cwd(), next), index += 1;
    else if (arg === '--output-json') parsed.outputJson = resolve(process.cwd(), next), index += 1;
    else if (arg === '--output-md') parsed.outputMarkdown = resolve(process.cwd(), next), index += 1;
    else if (arg === '--decision-all') {
      if (!THOMAS_DECISIONS.has(next as ThomasFinalDecision)) {
        throw new Error(`invalid_thomas_decision:${next}`);
      }
      parsed.decisionAll = next as ThomasFinalDecision;
      index += 1;
    }
  }

  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const approvalSweep = JSON.parse(readFileSync(args.approvalSweepJson, 'utf8')) as ThomasApprovalSweep & {
  candidates: ThomasAnnotatedApprovalSweepItem[];
};
if (args.decisionAll) {
  approvalSweep.candidates = approvalSweep.candidates.map((candidate) => ({
    ...candidate,
    thomasDecision: args.decisionAll,
    thomasDecisionReason: `explicit blanket decision supplied via --decision-all ${args.decisionAll}`
  }));
}
const exportPacket = buildThomasApprovedDraftExport({
  approvalSweep,
  sourceArtifacts: {
    approvalSweep: args.approvalSweepJson
  }
});

mkdirSync(dirname(args.outputJson), { recursive: true });
mkdirSync(dirname(args.outputMarkdown), { recursive: true });
writeFileSync(args.outputJson, `${JSON.stringify(exportPacket, null, 2)}\n`, 'utf8');
writeFileSync(args.outputMarkdown, renderThomasApprovedDraftExportMarkdown(exportPacket), 'utf8');

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'ok',
      mode: exportPacket.mode,
      outputJson: args.outputJson,
      outputMarkdown: args.outputMarkdown,
      approvedDraftCount: exportPacket.summary.approvedDraftCount,
      excludedCount: exportPacket.summary.excludedCount,
      excludedByDecisionType: exportPacket.summary.excludedByDecisionType,
      mutationAllowed: exportPacket.mutationAllowed,
      productionApplied: exportPacket.productionApplied
    },
    null,
    2
  )}\n`
);
