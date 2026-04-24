---
name: statistics-query
description: Query long-term statistics to analyze trends and anomalies.
when_to_use: User asks for trend analysis (energy, temperature, usage) over hours/days/months.
mutability: read_only
required_helper_commands:
  - statistics.query
risk_level: low
---

## Input checklist

- `statistic_ids` list
- Optional `start` / `end`
- Optional `period` (`5minute`, `hour`, `day`, `month`)

## Steps

1. Query stats:
   - `ha-helper statistics.query --input '{"statistic_ids":["sensor.energy_consumption"],"period":"day"}'`
2. Validate expected series exists.
3. Summarize trend and outliers.

## Output checklist

- Time-series availability
- Trend summary
- Outlier periods and likely explanations
