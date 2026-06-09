# MealScout Screenshot Processing Validation Report

- Mode: validation_export_only
- Mutation allowed: false
- Source: MealScout Screenshot Processing Final Sheet 2026-06-09
- Evidence rows: 896
- Unique evidence rows: 896
- Clean import candidates: 286
- Manual review rows: 46
- Rejected/quarantined rows: 451
- Duplicate groups: 100
- Rows with phone detected: 501
- Rows with email detected: 380

## Safety

- This report treats the source sheet as evidence only.
- No live profile apply/import is performed.
- Every source evidence row is preserved by drive_file_id.
- Clean candidates are grouped/collapsed from duplicate evidence; evidence rows are not deleted.
- Non-food service businesses are quarantined from MealScout import candidates.
- Suspicious names and possible truncations require manual review.

## Examples

- 1-8tyd1ovJviGaQdh8bUzyWu1d0pGBAIf: possible_truncated_business_name
- 1MYTL0nuEXkBndkLCkcBjVnhVYQOBNxiO: possible_truncated_business_name
- 1qV5MsNekQLHjOq6XIio96eD0G0_eMgAg: suspicious_business_name
- 1QsquSwY-jOrs74JNO8L5QnQyPa8ngXQ-: non_food_scope:home_services
- 157RwyOxslx7qC25duO8KmCs8wriutDsX: non_food_scope:painting
- 1-UE0dN2O4-lSbcHjQumIKZAKTYBHmSiL: missing_food_scope_signal
