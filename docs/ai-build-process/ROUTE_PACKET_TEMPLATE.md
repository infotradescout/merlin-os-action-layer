# Route Packet Template

Internal route packets convert approved intent into one bounded Codex execution slice.

Rule: Every internal route packet created from a customer request must reference the customer request packet that generated it. If the slice is internal-only, `customer_request_packet_id` must be explicitly set to `null` with a reason.

## Route Packet

```yaml
route_packet_id:
created_at_local:
brand:
product_surface:
user_persona:
desired_outcome:
primary_kpi:
current_blocker:
customer_request_packet_id:
customer_request_packet_null_reason:
doctrine_references:
  - 
allowed_terminology:
  - 
forbidden_terminology:
  - 
files_likely_involved:
  - 
required_behavior:
  - 
required_tests:
  - 
required_production_smoke:
  required:
  reason:
  domains_or_routes:
    - 
  forbidden_stale_content:
    - 
non_goals:
  - 
stop_conditions:
  - 
commit_instruction:
final_report_format:
```

## Field Guidance

### Brand

Name the brand lane. Brand lanes must remain isolated.

### Product Surface

Name the exact product area, route, workflow, document, or admin surface.

### User/Persona

Name the affected user or operator role. Do not invent customer-specific people or data.

### Desired Outcome

State the business or system result in one sentence.

### Primary KPI

Name the metric this slice should improve or protect. If the slice is governance-only, name the governance KPI, such as auditability, traceability, or served-reality confidence.

### Current Blocker

State what prevents the outcome today.

### Doctrine References

List governing doctrine files, sections, or decisions.

### customer_request_packet_id

Reference the customer request packet that generated this route packet.

If internal-only:

```yaml
customer_request_packet_id: null
customer_request_packet_null_reason: "Internal governance slice; no customer request generated this packet."
```

### Allowed Terminology

Terms Codex and Merlin may use for this slice.

### Forbidden Terminology

Terms that imply incorrect runtime behavior, unsafe authority, stale customer messaging, or cross-brand drift.

### Files Likely Involved

Expected files or directories to inspect. Codex may discover additional in-scope files, but must report them.

### Required Behavior

Specific behavior or documentation outcome required by the slice.

### Required Tests

Validation commands or explicit fallback validation.

### Required Production Smoke, If Applicable

Required when production behavior is affected. If not required, state why.

### Non-Goals

Every slice must declare what it will not do.

### Stop Conditions

Conditions that require Codex to stop and report instead of continuing.

### Commit Instruction

Exact commit behavior and commit message when authorized.

### Final Report Format

Required return format, including:

- Files changed
- Validation run and result
- Evidence summary
- Commit SHA when applicable
- Final git status
- Next best action or next route recommendation
