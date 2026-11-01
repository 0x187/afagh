// ═══ Role-based effective duty — port of lib/payroll-roles.ts (term load section) ═══
//
// finance-owner rule: duty comes from the professor's "role", not academic rank.
//   teaching = assigned roles with isTeaching=1;
//   base = dutyUnits of the first teaching role (minimum sortOrder);
//   effective = max(0, base − Σ reductionUnits of all assigned roles).
package payroll

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LoadTermEffectiveDuties bulk-loads effective duties for all professors of a term
// (one query; output: staffId → effective duty; absent from the map = no teaching role).
func LoadTermEffectiveDuties(ctx context.Context, pool *pgxpool.Pool, termID int64) map[int64]float64 {
	out := map[int64]float64{}
	rows, err := pool.Query(ctx, `
		WITH ranked AS (
		  SELECT str."staffId" AS "staffId",
		         r."dutyUnits"::float8 AS "dutyUnits",
		         r."reductionUnits"::float8 AS "reductionUnits",
		         r."isTeaching" AS "isTeaching",
		         r."sortOrder" AS "sortOrder",
		         ROW_NUMBER() OVER (
		           PARTITION BY str."staffId"
		           ORDER BY r."sortOrder" ASC, r."id" ASC
		         ) AS rn_teaching
		  FROM "staff_term_roles" str
		  JOIN "payroll_duty_roles" r ON r."id" = str."roleId"
		  WHERE str."termId" = $1 AND r."isTeaching" = 1
		),
		base AS (
		  SELECT "staffId", COALESCE(MAX(CASE WHEN rn_teaching = 1 THEN "dutyUnits" END), 0) AS "base"
		  FROM ranked GROUP BY "staffId"
		),
		red AS (
		  SELECT str."staffId" AS "staffId", COALESCE(SUM(r."reductionUnits"::float8), 0) AS "red"
		  FROM "staff_term_roles" str
		  JOIN "payroll_duty_roles" r ON r."id" = str."roleId"
		  WHERE str."termId" = $1
		  GROUP BY str."staffId"
		)
		SELECT b."staffId", GREATEST(0, b."base" - COALESCE(r."red", 0)) AS "duty"
		FROM base b LEFT JOIN red r ON r."staffId" = b."staffId"`, termID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var sid int64
		var duty float64
		if err := rows.Scan(&sid, &duty); err == nil {
			out[sid] = duty
		}
	}
	return out
}
