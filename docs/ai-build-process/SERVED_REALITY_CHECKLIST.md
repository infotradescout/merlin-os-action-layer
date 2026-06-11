# Served-Reality Checklist

Served-reality verification proves that production or served behavior matches the completed slice.

Required rule: A production-facing slice cannot be marked complete until served reality is verified or explicitly marked blocked with a failure reason.

Local tests are necessary but not sufficient for production-facing behavior.

## Checklist

```yaml
served_reality_result_id:
route_packet_id:
slice_id:
checked_at_local:
checked_by:
production_smoke_required:
expected_commit_or_build_marker:
domains_or_routes_to_check:
  - 
http_status_expectations:
  - route:
    expected_status:
required_visible_copy:
  - 
forbidden_stale_copy:
  - 
required_action_path:
  - 
required_telemetry_or_evidence:
  - 
cache_or_stale_deploy_failure_handling:
  - 
result:
failure_reason:
evidence_refs:
  - 
```

## Expected Commit/Build Marker

Record the commit SHA, deployment ID, build label, version marker, or other available marker that proves the served environment contains the intended change.

If no marker is available, record that limitation and use route/content evidence instead.

## Domains/Routes To Check

List every served domain, route, admin URL, API endpoint, or workflow path affected by the slice.

## HTTP Status Expectations

For each relevant route, record expected HTTP status. Include redirects if they are part of the intended behavior.

## Required Visible Copy

List visible text, labels, headings, or customer-facing states that must appear in the served environment.

## Forbidden Stale Copy

List stale text, old labels, deprecated claims, incorrect buttons, unsafe language, or outdated status messages that must not appear.

Every production-facing change must define forbidden stale content or forbidden behavior where applicable.

## Required Action Path

Describe the user or operator path that must work. Include only the path required by the slice.

## Required Telemetry/Evidence

Capture evidence before declaring success. Evidence may include screenshots, response bodies, status checks, logs, analytics events, or browser verification notes.

## Cache/Stale Deploy Failure Handling

If served reality does not match local or committed reality:

1. Mark the served-reality result as blocked.
2. Record the stale route, stale copy, wrong status, or missing marker.
3. Do not declare the slice complete.
4. Recommend the next route for deploy/cache/build investigation.

## Final Pass/Fail Report Format

```text
Served Reality Result:
- route_packet_id:
- slice_id:
- checked_by:
- expected commit/build marker:
- routes checked:
- required visible copy:
- forbidden stale copy:
- required action path:
- evidence refs:
- result: pass | blocked | fail
- failure reason:
- next route recommendation:
```
