"""
generate_ifi_topup_sql.py
==========================
Generates ifi_topup_demo.sql — an INSERT-only addition (no deletes) that
pushes four zones over the Infrastructure Fragility Index's minimum report
threshold (MIN_N_FOR_INDEX = 10 qualifying reports, snapped by proximity
to a MELAKA_ZONES centroid), with a deliberate spread of outcomes so the
IFI zone chart shows more than one flat result:

  - Batu Berendam, Alor Gajah: mostly clean resolves, no reincidence
    engineered in -> should land Good/Optimal.
  - Ujong Pasir: one engineered reincidence pair among otherwise clean
    reports -> a moderate failure rate, landing somewhere in the middle.
  - Cheng: three engineered reincidence pairs -> a high failure rate,
    landing Critical/At Risk.

Reuses seed_hotspot_demo.build_row so the row shape and workflow-field
derivation (assigned_department, forwarded_at, resolved_at, etc.) stays
identical to the rest of the demo data instead of a second, drifting copy.

Usage:
    cd smart_city_citizen_reporting_app/ai_backend
    python ../../decision_support_system_web/generate_ifi_topup_sql.py
"""

import random
import sys
import os
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
random.seed(7)

import seed_hotspot_demo as seed  # noqa: E402
from generate_seed_sql import COLUMNS, format_row  # noqa: E402

OUTPUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ifi_topup_demo.sql")


def reincidence_pair(category, address, center, days_back, resolved_after_days=5, reappear_after_days=35):
    lat, lng = center
    rows = []
    orig_ts = seed.days_ago(days_back)
    rows.append(seed.build_row(category=category, lat=lat, lng=lng, address=address,
                                timestamp=orig_ts, status="Resolved",
                                resolved_after_days=resolved_after_days, upvotes=random.randint(2, 8)))
    rows.append(seed.build_row(category=category, lat=lat + 0.00004, lng=lng + 0.00004, address=address,
                                timestamp=orig_ts + timedelta(days=reappear_after_days), status="Pending",
                                upvotes=random.randint(1, 5)))
    return rows


def clean_batch(zone_center, address, categories, days_back_list, statuses):
    """Reports with no engineered reincidence — just a plain, varied history."""
    lat0, lng0 = zone_center
    rows = []
    for cat, days_back, status in zip(categories, days_back_list, statuses):
        lat = lat0 + random.uniform(-0.004, 0.004)
        lng = lng0 + random.uniform(-0.004, 0.004)
        rows.append(seed.build_row(category=cat, lat=lat, lng=lng, address=address,
                                    timestamp=seed.days_ago(days_back), status=status,
                                    upvotes=random.randint(0, 15)))
    return rows


def main():
    rows = []

    # Batu Berendam — already close to the threshold, push comfortably over
    # with a clean history (no reincidence) so it should score Good/Optimal.
    rows += clean_batch(
        (2.2401, 102.26725), "Batu Berendam, Melaka",
        ["Road Damage", "Waste", "Street Lighting", "Broken Sidewalk", "Overgrown Vegetation", "Fallen Tree", "Road Sign"],
        [50, 44, 38, 32, 26, 20, 14],
        ["Resolved", "Resolved", "Resolved", "Resolved", "Pending", "In Review", "In Process"],
    )

    # Alor Gajah — different district (population-normalized rate looks
    # different here than the three Melaka Tengah zones), also clean.
    rows += clean_batch(
        (2.3818, 102.2055), "Pekan Alor Gajah, Melaka",
        ["Road Damage", "Drainage", "Vandalism", "Waste", "Street Lighting", "Fallen Tree", "Road Sign"],
        [48, 42, 36, 30, 24, 18, 12],
        ["Resolved", "Resolved", "Resolved", "Resolved", "Pending", "In Review", "In Maintenance"],
    )

    # Ujong Pasir — mostly clean, one reincidence pair mixed in for a
    # moderate failure rate.
    rows += clean_batch(
        (2.1815, 102.2605), "Ujong Pasir, Melaka",
        ["Road Damage", "Waste", "Street Lighting", "Broken Sidewalk", "Overgrown Vegetation"],
        [46, 40, 34, 28, 16],
        ["Resolved", "Resolved", "Pending", "In Review", "In Process"],
    )
    rows += reincidence_pair("Drainage", "Ujong Pasir, Melaka", (2.1815, 102.2605), days_back=60)

    # Cheng — three engineered reincidence pairs among a smaller clean base,
    # aiming for a high failure rate (Critical/At Risk).
    rows += clean_batch(
        (2.22215, 102.21525), "Taman Cheng Baru, Melaka",
        ["Waste", "Broken Sidewalk", "Road Sign"],
        [45, 33, 15],
        ["Resolved", "Pending", "In Review"],
    )
    rows += reincidence_pair("Road Damage", "Jalan Cheng, Melaka", (2.2195, 102.2120), days_back=65)
    rows += reincidence_pair("Drainage", "Kampung Cheng, Melaka", (2.2150, 102.2250), days_back=58)
    rows += reincidence_pair("Vandalism", "Taman Cheng Baru, Melaka", (2.2225, 102.2145), days_back=52)

    body = ",\n".join(format_row(r) for r in rows)

    sql = f"""-- ifi_topup_demo.sql
-- Generated by generate_ifi_topup_sql.py. Adds reports to four zones
-- (Batu Berendam, Alor Gajah, Ujong Pasir, Cheng) so each crosses the
-- Infrastructure Fragility Index's 10-report minimum, with a deliberate
-- spread: Batu Berendam/Alor Gajah clean (expect Good/Optimal), Ujong
-- Pasir one reincidence pair (expect moderate), Cheng three reincidence
-- pairs (expect Critical/At Risk).
--
-- INSERT-only — does not delete or modify any existing report. Safe to
-- run on top of an already-seeded database.

BEGIN;

WITH citizen AS (
  SELECT "userID" FROM "User" LIMIT 1
)
INSERT INTO "Complaint" (
    "userID", "title", "description", "predictedCategory",
    "imageValidation", "confidence", "image",
    "longitude", "latitude", "status", "location", "address",
    "timestamp", "assigned_department", "authority_notes",
    "forwarded_at", "reviewed_at", "assigned_worker",
    "in_process_at", "in_maintenance_at", "resolved_at",
    "worker_completed", "upvotes", "categories"
)
SELECT citizen."userID", v.*
FROM citizen, (VALUES
{body}
) AS v(
    title, description, "predictedCategory", "imageValidation", confidence,
    image, longitude, latitude, status, location, address,
    "timestamp", assigned_department, authority_notes, forwarded_at,
    reviewed_at, assigned_worker, in_process_at, in_maintenance_at,
    resolved_at, worker_completed, upvotes, categories
);

COMMIT;

-- Verify:
-- SELECT status, COUNT(*) FROM "Complaint" GROUP BY status ORDER BY COUNT(*) DESC;
-- Expect +{len(rows)} rows on top of whatever was already there.
"""

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(sql)

    print(f"Wrote {len(rows)} rows to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
