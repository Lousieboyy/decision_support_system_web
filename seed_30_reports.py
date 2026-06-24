import os
import random
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# ── Load .env from the backend directory ──────────────────────
BACKEND_DIR = "c:/Users/User/smart_city_citizen_reporting_app/ai_backend"
env_path = os.path.join(BACKEND_DIR, ".env")
load_dotenv(env_path)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(f"DATABASE_URL not found. Checked: {env_path}")

engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)

# ── Real Melaka Locations (30 entries) ────────────────────────
MELAKA_LOCATIONS = [
    (2.1896, 102.2501, "Jalan Merdeka, Bandar Hilir, Melaka"),
    (2.1914, 102.2486, "Jalan Laksamana, Bandar Hilir, Melaka"),
    (2.1935, 102.2462, "Jalan Hang Hang Hang Jebat (Jonker Street), Melaka"),
    (2.1953, 102.2505, "Jalan Tun Sri Lanang, Melaka"),
    (2.1878, 102.2528, "Jalan Taman Melaka Raya, Melaka"),
    (2.1842, 102.2514, "Taman Melaka Raya, Melaka"),
    (2.2032, 102.2587, "Jalan Bukit Baru, Melaka"),
    (2.2085, 102.2542, "Kampung Bukit Baru, Melaka"),
    (2.1992, 102.2440, "Jalan Kota Laksamana, Melaka"),
    (2.1968, 102.2392, "Kampung Morten, Melaka"),
    (2.2648, 102.2920, "Jalan Ayer Keroh, Melaka"),
    (2.2705, 102.2875, "Taman Ayer Keroh, Melaka"),
    (2.2580, 102.2960, "Lebuh Ayer Keroh, Melaka"),
    (2.2732, 102.2830, "Taman Tasik Ayer Keroh, Melaka"),
    (2.3125, 102.1925, "Pekan Durian Tunggal, Alor Gajah"),
    (2.3215, 102.1870, "Jalan Utama, Durian Tunggal"),
    (2.3818, 102.2055, "Pekan Alor Gajah, Melaka"),
    (2.3098, 102.4310, "Pekan Jasin, Melaka"),
    (2.3045, 102.4380, "Jalan Jasin-Bemban, Melaka"),
    (2.3522, 102.0845, "Pekan Masjid Tanah, Melaka"),
    (2.2382, 102.2645, "Batu Berendam, Melaka"),
    (2.2420, 102.2700, "Taman Batu Berendam, Melaka"),
    (2.2248, 102.2185, "Taman Cheng Baru, Melaka"),
    (2.2195, 102.2120, "Jalan Cheng, Melaka"),
    (2.2478, 102.2885, "Taman Krubong Jaya, Melaka"),
    (2.2180, 102.2720, "Bukit Katil, Melaka"),
    (2.2065, 102.2340, "Tangga Batu, Melaka"),
    (2.2142, 102.2475, "Taman Bachang, Melaka"),
    (2.2280, 102.2050, "Pantai Klebang, Melaka"),
    (2.1815, 102.2605, "Ujong Pasir, Melaka"),
]

# ── Categories with EXACT matching verified images ─────────────────
CATEGORIES = [
    "Street Lighting",
    "Road Damage",
    "Drainage",
    "Overgrown Vegetation",
    "Broken Sidewalk",
    "Road Sign",
    "Vandalism",
]

AI_PREDICTIONS = {
    "Street Lighting": "Street_Light",
    "Road Damage": "Pothole",
    "Drainage": "Drainage",
    "Overgrown Vegetation": "Overgrown_Vegetation",
    "Broken Sidewalk": "Broken_Sidewalk",
    "Road Sign": "Road_Sign",
    "Vandalism": "Vandalism",
}

DEPT_ASSIGNMENT = {
    "Street Lighting": "MBMB (Majlis Bandaraya Melaka Bersejarah)",
    "Road Damage": "JKR (Jabatan Kerja Raya Melaka)",
    "Drainage": "JKR (Jabatan Kerja Raya Melaka)",
    "Overgrown Vegetation": "MBMB (Majlis Bandaraya Melaka Bersejarah)",
    "Broken Sidewalk": "MBMB (Majlis Bandaraya Melaka Bersejarah)",
    "Road Sign": "JKR (Jabatan Kerja Raya Melaka)",
    "Vandalism": "MBMB (Majlis Bandaraya Melaka Bersejarah)",
}

ACCURATE_IMAGES = {
    "Street Lighting": [
        "/uploads/2877fcb6-d71f-4706-aae1-4674f2d5c400.jpg",
        "/uploads/4beb5bd2-881a-4e4a-8a04-dd4f5a1904e5.jpg",
        "/uploads/a3ccc54c-9bdd-4d17-bbab-b8417e450289.jpg",
        "/uploads/a9129dd2-888f-4d5c-b102-807a49e042b2.jpg",
        "/uploads/e588cdda-eaa8-4d12-9271-b2cc14162073.jpg"
    ],
    "Road Damage": [
        "/uploads/0875155a-9c73-4a91-a1d8-b9f8645ff1d9.jpg",
        "/uploads/34677595-c1d9-4fec-8df6-151218e66418.jpg",
        "/uploads/5362d52e-27fc-424d-96d1-85b73f489715.jpg",
        "/uploads/d8e24f7c-96ed-490c-85b5-4b4a0f9c5ca5.jpg",
        "/uploads/fff147ee-40c4-42ef-8d35-9f5635937185.jpg"
    ],
    "Drainage": [
        "/uploads/067beb81-aa38-4875-8302-0f0f876a7588.jpg"
    ],
    "Overgrown Vegetation": [
        "/uploads/01dcf303-5d18-4d04-901e-47710a911dad.jpg",
        "/uploads/5b6a4bbc-f168-4431-aff8-36445cafc524.jpg",
        "/uploads/97f1b732-d50a-49fc-a8e2-40fa86d4ae3c.jpg",
        "/uploads/a5f1782f-3e9a-495b-8307-eba9219c1555.jpg",
        "/uploads/d89859ce-de81-48a9-b992-5e13ff4de11b.jpg"
    ],
    "Broken Sidewalk": [
        "/uploads/d109eece-d094-48f8-9c39-1e925a936f26.png"
    ],
    "Road Sign": [
        "/uploads/191037f6-c48f-4368-8ab3-6c9ac54d2e90.jpg"
    ],
    "Vandalism": [
        "/uploads/606e2bef-dbe0-4071-b188-02f969ead250.webp"
    ]
}

DESCRIPTIONS = {
    "Street Lighting": [
        "Street light not working for 2 weeks. Very dark and unsafe at night.",
        "LED street lamp flickering on and off constantly, creating hazardous visibility.",
        "Fallen street light pole blocking part of the sidewalk. Electrical wires exposed.",
        "Multiple street lights out on this entire stretch of road.",
    ],
    "Road Damage": [
        "Deep pothole causing vehicles to swerve dangerously into oncoming traffic.",
        "Large crack spanning across both lanes. Getting worse with rain.",
        "Road surface completely eroded after recent heavy rain. Very dangerous.",
        "Multiple potholes at junction causing accidents. Urgent repair needed.",
    ],
    "Drainage": [
        "Clogged drain causing water to pool on the road during rain.",
        "Broken drainage cover on sidewalk. Pedestrian safety hazard.",
        "Storm drain overflow flooding the residential area every time it rains.",
    ],
    "Overgrown Vegetation": [
        "Overgrown bushes blocking visibility at T-junction. Accident risk.",
        "Tree branches hanging low over the road, hitting passing vehicles.",
        "Wild vegetation encroaching onto pedestrian walkway.",
    ],
    "Broken Sidewalk": [
        "Sidewalk tiles broken and uneven. Elderly residents tripping frequently.",
        "Large section of pavement crumbled. Wheelchair users cannot pass.",
        "Sidewalk collapsed near bus stop. Trip hazard.",
    ],
    "Vandalism": [
        "Graffiti and structural damage on the community hall walls.",
        "Bus stop shelter glass panels smashed. Safety concern.",
    ],
    "Road Sign": [
        "Stop sign knocked down at busy intersection. Accident risk.",
        "Road sign faded and unreadable. Confusing for drivers.",
    ],
}

TITLES = {
    "Street Lighting": ["Broken Street Light", "Flickering Lamp", "Fallen Lamp Post", "Street Light Outage"],
    "Road Damage": ["Deep Pothole", "Road Crack", "Eroded Road Surface", "Multiple Potholes"],
    "Drainage": ["Clogged Drain", "Broken Drain Cover", "Storm Drain Flood"],
    "Overgrown Vegetation": ["Overgrown Bush", "Low Hanging Branches", "Wild Vegetation Encroachment"],
    "Broken Sidewalk": ["Broken Tiles", "Crumbled Pavement", "Collapsed Sidewalk"],
    "Vandalism": ["Graffiti & Bench Damage", "Bus Stop Vandalized"],
    "Road Sign": ["Stop Sign Down", "Faded Sign Warning"],
}

STATUS_WEIGHTS = [
    ("Pending", 8),
    ("In Review", 4),
    ("In Process", 6),
    ("In Maintenance", 5),
    ("Resolved", 6),
    ("Rejected", 1),
]

WORKERS = ["worker", "worker1", "worker2"]

def random_status():
    pool = []
    for s, w in STATUS_WEIGHTS:
        pool.extend([s] * w)
    return random.choice(pool)

def random_timestamp_within_days(days=60):
    offset = random.randint(0, days * 24 * 60)
    dt = datetime.now(timezone.utc) - timedelta(minutes=offset)
    return dt

def main():
    db = Session()
    try:
        print("Deleting all existing reports and resetting ID sequence...")
        db.execute(text('TRUNCATE TABLE "report_upvotes" CASCADE'))
        db.execute(text('TRUNCATE TABLE "Issue" CASCADE'))
        db.execute(text('TRUNCATE TABLE "AuthorityAction" CASCADE'))
        db.execute(text('TRUNCATE TABLE "Complaint" RESTART IDENTITY CASCADE'))
        db.commit()
        print("All existing reports deleted and ID sequence reset.")

        # Get citizen user ID
        result = db.execute(text('SELECT "userID" FROM "User" LIMIT 1')).fetchone()
        if not result:
            print("ERROR: No citizen user found in User table.")
            return
        citizen_id = result[0]
        print(f"Using citizen user ID: {citizen_id}")

        print("\nGenerating 30 highly accurate clustered reports in memory...")
        reports_data = []

        # ── Cluster 1: 3 Active Street Lighting reports at Jonker Street (Jalan Hang Hang Hang Jebat) ──
        cluster1_coords = [
            (2.1936, 102.2463, "Jalan Hang Hang Hang Jebat (Jonker Street), Melaka"),
            (2.1934, 102.2461, "Jalan Hang Kasturi (near Jonker Street), Melaka"),
            (2.1937, 102.2461, "Jalan Hang Lekiu (near Jonker Street), Melaka")
        ]
        for idx, (lat, lng, addr) in enumerate(cluster1_coords):
            reports_data.append({
                "title": TITLES["Street Lighting"][idx % len(TITLES["Street Lighting"])],
                "description": DESCRIPTIONS["Street Lighting"][idx % len(DESCRIPTIONS["Street Lighting"])],
                "ai_prediction": AI_PREDICTIONS["Street Lighting"],
                "image_validation": "Street Lighting",
                "confidence": f"{random.randint(88, 98)}%",
                "image_path": ACCURATE_IMAGES["Street Lighting"][idx % len(ACCURATE_IMAGES["Street Lighting"])],
                "longitude": lng,
                "latitude": lat,
                "status": "Pending" if idx == 0 else "In Process",
                "location": "75200, Melaka, Malaysia",
                "address": addr,
                "timestamp": datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 24)),
                "assigned_department": DEPT_ASSIGNMENT["Street Lighting"] if idx > 0 else None,
                "authority_notes": "Verified. Forwarded to MBMB." if idx > 0 else None,
                "forwarded_at": (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat() if idx > 0 else None,
                "reviewed_at": (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat() if idx > 0 else None,
                "assigned_worker": "worker" if idx > 0 else None,
                "in_process_at": (datetime.now(timezone.utc) - timedelta(hours=10)).isoformat() if idx > 0 else None,
                "in_maintenance_at": None,
                "resolved_at": None,
                "worker_completed": 0,
                "upvotes": random.randint(3, 12),
                "categories": "Street Lighting",
            })

        # ── Cluster 2: 3 Active Road Damage reports at Jonker Street (Jalan Hang Hang Hang Jebat) ──
        cluster2_coords = [
            (2.1936, 102.2460, "Jalan Hang Hang Hang Jebat (Jonker Street), Melaka"),
            (2.1933, 102.2463, "Jalan Hang Kasturi (near Jonker Street), Melaka"),
            (2.1935, 102.2462, "Jalan Hang Lekiu (near Jonker Street), Melaka")
        ]
        for idx, (lat, lng, addr) in enumerate(cluster2_coords):
            reports_data.append({
                "title": TITLES["Road Damage"][idx % len(TITLES["Road Damage"])],
                "description": DESCRIPTIONS["Road Damage"][idx % len(DESCRIPTIONS["Road Damage"])],
                "ai_prediction": AI_PREDICTIONS["Road Damage"],
                "image_validation": "Road Damage",
                "confidence": f"{random.randint(88, 98)}%",
                "image_path": ACCURATE_IMAGES["Road Damage"][idx % len(ACCURATE_IMAGES["Road Damage"])],
                "longitude": lng,
                "latitude": lat,
                "status": "In Process" if idx == 0 else "Pending",
                "location": "75200, Melaka, Malaysia",
                "address": addr,
                "timestamp": datetime.now(timezone.utc) - timedelta(hours=random.randint(12, 48)),
                "assigned_department": DEPT_ASSIGNMENT["Road Damage"] if idx == 0 else None,
                "authority_notes": "Verified. Forwarded to JKR." if idx == 0 else None,
                "forwarded_at": (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat() if idx == 0 else None,
                "reviewed_at": (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat() if idx == 0 else None,
                "assigned_worker": "worker1" if idx == 0 else None,
                "in_process_at": (datetime.now(timezone.utc) - timedelta(hours=20)).isoformat() if idx == 0 else None,
                "in_maintenance_at": None,
                "resolved_at": None,
                "worker_completed": 0,
                "upvotes": random.randint(4, 15),
                "categories": "Road Damage",
            })

        # ── Cluster 3: 3 Active Drainage reports at Jonker Street (Jalan Hang Hang Hang Jebat) ──
        cluster3_coords = [
            (2.1934, 102.2460, "Jalan Hang Hang Hang Jebat (Jonker Street), Melaka"),
            (2.1937, 102.2464, "Jalan Hang Kasturi (near Jonker Street), Melaka"),
            (2.1933, 102.2461, "Jalan Hang Lekiu (near Jonker Street), Melaka")
        ]
        for idx, (lat, lng, addr) in enumerate(cluster3_coords):
            reports_data.append({
                "title": TITLES["Drainage"][idx % len(TITLES["Drainage"])],
                "description": DESCRIPTIONS["Drainage"][idx % len(DESCRIPTIONS["Drainage"])],
                "ai_prediction": AI_PREDICTIONS["Drainage"],
                "image_validation": "Drainage",
                "confidence": f"{random.randint(88, 98)}%",
                "image_path": ACCURATE_IMAGES["Drainage"][0],
                "longitude": lng,
                "latitude": lat,
                "status": "In Process" if idx == 0 else "Pending",
                "location": "75200, Melaka, Malaysia",
                "address": addr,
                "timestamp": datetime.now(timezone.utc) - timedelta(hours=random.randint(24, 72)),
                "assigned_department": DEPT_ASSIGNMENT["Drainage"] if idx == 0 else None,
                "authority_notes": "Verified. Forwarded to JKR." if idx == 0 else None,
                "forwarded_at": (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat() if idx == 0 else None,
                "reviewed_at": (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat() if idx == 0 else None,
                "assigned_worker": "worker2" if idx == 0 else None,
                "in_process_at": (datetime.now(timezone.utc) - timedelta(hours=40)).isoformat() if idx == 0 else None,
                "in_maintenance_at": None,
                "resolved_at": None,
                "worker_completed": 0,
                "upvotes": random.randint(2, 8),
                "categories": "Drainage",
            })

        # ── Remainder: 21 Reports scattered across other distant locations ──
        for i in range(9, 30):
            loc = MELAKA_LOCATIONS[(i - 5) % len(MELAKA_LOCATIONS)]
            lat, lng, address = loc
            
            # Avoid placing them back in the Hang Hang Hang Jebat area to prevent false clustering
            if "Jonker Street" in address or "Jalan Laksamana" in address or "Jalan Merdeka" in address:
                loc = MELAKA_LOCATIONS[10] # Ayer Keroh
                lat, lng, address = loc
                
            category = CATEGORIES[i % len(CATEGORIES)]
            status = "Resolved" if i % 4 == 0 else random_status()
            
            # Resolved reports must be recent so they appear green on map
            timestamp = datetime.now(timezone.utc) - timedelta(days=2) if status == "Resolved" else random_timestamp_within_days(45)
            confidence = f"{random.randint(85, 99)}%"
            image = random.choice(ACCURATE_IMAGES[category])
            title = random.choice(TITLES[category])
            description = random.choice(DESCRIPTIONS[category])
            ai_pred = AI_PREDICTIONS[category]
            upvotes = random.randint(0, 5)
            
            assigned_dept = None
            assigned_worker = None
            forwarded_at = None
            reviewed_at = None
            in_process_at = None
            in_maintenance_at = None
            resolved_at = None
            authority_notes = None
            
            if status in ("In Review", "In Process", "In Maintenance", "Resolved"):
                assigned_dept = DEPT_ASSIGNMENT[category]
                reviewed_at = (timestamp + timedelta(hours=random.randint(1, 12))).isoformat()
                forwarded_at = reviewed_at
                authority_notes = f"Verified. Forwarded to {assigned_dept.split(' ')[0]}."
                
            if status in ("In Process", "In Maintenance", "Resolved"):
                assigned_worker = random.choice(WORKERS)
                in_process_at = (timestamp + timedelta(hours=random.randint(12, 36))).isoformat()
                
            if status in ("In Maintenance", "Resolved"):
                in_maintenance_at = (timestamp + timedelta(hours=random.randint(36, 72))).isoformat()
                
            if status == "Resolved":
                resolved_at = (timestamp + timedelta(hours=random.randint(72, 144))).isoformat()
                
            if status == "Rejected":
                authority_notes = "Invalid submission / spam report."

            location = f"{random.randint(75000, 78000)}, Melaka, Malaysia"
            
            reports_data.append({
                "title": title,
                "description": description,
                "ai_prediction": ai_pred,
                "image_validation": category,
                "confidence": confidence,
                "image_path": image,
                "longitude": round(lng, 6),
                "latitude": round(lat, 6),
                "status": status,
                "location": location,
                "address": address,
                "timestamp": timestamp,
                "assigned_department": assigned_dept,
                "authority_notes": authority_notes,
                "forwarded_at": forwarded_at,
                "reviewed_at": reviewed_at,
                "assigned_worker": assigned_worker,
                "in_process_at": in_process_at,
                "in_maintenance_at": in_maintenance_at,
                "resolved_at": resolved_at,
                "worker_completed": 1 if status in ("In Maintenance", "Resolved") else 0,
                "upvotes": upvotes,
                "categories": category,
            })

        # Sort chronologically by timestamp (oldest first)
        reports_data.sort(key=lambda r: r["timestamp"])
        
        print("\nInserting reports in chronological order...")
        for i, rep in enumerate(reports_data):
            db.execute(text("""
                INSERT INTO "Complaint" (
                    "userID", "title", "description", "predictedCategory", 
                    "imageValidation", "confidence", "image", 
                    "longitude", "latitude", "status", "location", "address",
                    "timestamp", "assigned_department", "authority_notes",
                    "forwarded_at", "reviewed_at", "assigned_worker",
                    "in_process_at", "in_maintenance_at", "resolved_at",
                    "worker_completed", "upvotes", "categories"
                ) VALUES (
                    :user_id, :title, :description, :ai_prediction,
                    :image_validation, :confidence, :image_path,
                    :longitude, :latitude, :status, :location, :address,
                    :timestamp, :assigned_department, :authority_notes,
                    :forwarded_at, :reviewed_at, :assigned_worker,
                    :in_process_at, :in_maintenance_at, :resolved_at,
                    :worker_completed, :upvotes, :categories
                )
            """), {
                "user_id": citizen_id,
                "title": rep["title"],
                "description": rep["description"],
                "ai_prediction": rep["ai_prediction"],
                "image_validation": rep["image_validation"],
                "confidence": rep["confidence"],
                "image_path": rep["image_path"],
                "longitude": rep["longitude"],
                "latitude": rep["latitude"],
                "status": rep["status"],
                "location": rep["location"],
                "address": rep["address"],
                "timestamp": rep["timestamp"],
                "assigned_department": rep["assigned_department"],
                "authority_notes": rep["authority_notes"],
                "forwarded_at": rep["forwarded_at"],
                "reviewed_at": rep["reviewed_at"],
                "assigned_worker": rep["assigned_worker"],
                "in_process_at": rep["in_process_at"],
                "in_maintenance_at": rep["in_maintenance_at"],
                "resolved_at": rep["resolved_at"],
                "worker_completed": rep["worker_completed"],
                "upvotes": rep["upvotes"],
                "categories": rep["categories"],
            })
            
            # Find category ID to add Issue record
            cat_record = db.execute(text('SELECT "categoryID" FROM "Category" WHERE name = :name'), {"name": rep["categories"]}).fetchone()
            if cat_record:
                # Add record to Issue table
                new_comp_id = db.execute(text('SELECT MAX("complaintID") FROM "Complaint"')).scalar()
                db.execute(text('INSERT INTO "Issue" ("complaintID", "categoryID", count) VALUES (:comp_id, :cat_id, 1)'), {
                    "comp_id": new_comp_id,
                    "cat_id": cat_record[0]
                })

            print(f"  [{i+1:02d}] ID: {new_comp_id or (i+1)} | Date: {rep['timestamp'].strftime('%Y-%m-%d %H:%M')} | {rep['status']:15s} | {rep['categories']:22s}")

        db.commit()
        
        # Verification
        count = db.execute(text('SELECT COUNT(*) FROM "Complaint"')).scalar()
        print(f"\n{'='*60}")
        print(f"  Done! {count} accurate reports seeded successfully (with hotspots).")
        print(f"{'='*60}")
        
    except Exception as e:
        db.rollback()
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    main()
