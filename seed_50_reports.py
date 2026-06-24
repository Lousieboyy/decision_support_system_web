"""
seed_50_reports.py
==================
Deletes ALL existing reports (Complaint table) from the PostgreSQL database
and seeds ~50 new reports spread across Melaka with realistic data.

Usage:
    cd smart_city_citizen_reporting_app/ai_backend
    python ../../decision_support_system_web/seed_50_reports.py

Or from any directory (it resolves .env automatically).
"""

import os
import random
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# ── Load .env from the backend directory ──────────────────────
BACKEND_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "smart_city_citizen_reporting_app",
    "ai_backend",
)
env_path = os.path.join(BACKEND_DIR, ".env")
load_dotenv(env_path)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(f"DATABASE_URL not found. Checked: {env_path}")

engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)

# ── Real Melaka Locations (50 entries) ────────────────────────
# Latitude/longitude pairs spread across Melaka state
MELAKA_LOCATIONS = [
    # Central Melaka / Bandar Hilir
    (2.1896, 102.2501, "Jalan Merdeka, Bandar Hilir, Melaka"),
    (2.1914, 102.2486, "Jalan Laksamana, Bandar Hilir, Melaka"),
    (2.1935, 102.2462, "Jalan Hang Jebat (Jonker Street), Melaka"),
    (2.1953, 102.2505, "Jalan Tun Sri Lanang, Melaka"),
    (2.1878, 102.2528, "Jalan Taman Melaka Raya, Melaka"),
    (2.1842, 102.2514, "Taman Melaka Raya, Melaka"),
    # Bukit Baru / Kota Laksamana
    (2.2032, 102.2587, "Jalan Bukit Baru, Melaka"),
    (2.2085, 102.2542, "Kampung Bukit Baru, Melaka"),
    (2.1992, 102.2440, "Jalan Kota Laksamana, Melaka"),
    (2.1968, 102.2392, "Kampung Morten, Melaka"),
    # Ayer Keroh
    (2.2648, 102.2920, "Jalan Ayer Keroh, Melaka"),
    (2.2705, 102.2875, "Taman Ayer Keroh, Melaka"),
    (2.2580, 102.2960, "Lebuh Ayer Keroh, Melaka"),
    (2.2732, 102.2830, "Taman Tasik Ayer Keroh, Melaka"),
    # Durian Tunggal / Alor Gajah
    (2.3125, 102.1925, "Pekan Durian Tunggal, Alor Gajah"),
    (2.3215, 102.1870, "Jalan Utama, Durian Tunggal"),
    (2.3818, 102.2055, "Pekan Alor Gajah, Melaka"),
    (2.3742, 102.2130, "Jalan Dato Muda Alor Gajah"),
    # Jasin
    (2.3098, 102.4310, "Pekan Jasin, Melaka"),
    (2.3045, 102.4380, "Jalan Jasin-Bemban, Melaka"),
    (2.2980, 102.4250, "Taman Sri Jasin, Melaka"),
    # Masjid Tanah
    (2.3522, 102.0845, "Pekan Masjid Tanah, Melaka"),
    (2.3480, 102.0890, "Jalan Masjid Tanah, Melaka"),
    # Batu Berendam / Melaka Tengah
    (2.2382, 102.2645, "Batu Berendam, Melaka"),
    (2.2420, 102.2700, "Taman Batu Berendam, Melaka"),
    (2.2315, 102.2580, "Jalan Batu Berendam, Melaka"),
    # Cheng / Bertam
    (2.2248, 102.2185, "Taman Cheng Baru, Melaka"),
    (2.2195, 102.2120, "Jalan Cheng, Melaka"),
    (2.2150, 102.2250, "Kampung Cheng, Melaka"),
    # Krubong
    (2.2478, 102.2885, "Taman Krubong Jaya, Melaka"),
    (2.2520, 102.2830, "Jalan Krubong, Melaka"),
    # Bukit Katil
    (2.2180, 102.2720, "Bukit Katil, Melaka"),
    (2.2225, 102.2780, "Taman Bukit Katil, Melaka"),
    # Tangga Batu
    (2.2065, 102.2340, "Tangga Batu, Melaka"),
    (2.2010, 102.2285, "Jalan Tangga Batu, Melaka"),
    # Bachang
    (2.2142, 102.2475, "Taman Bachang, Melaka"),
    (2.2105, 102.2520, "Jalan Bachang, Melaka"),
    # Klebang
    (2.2280, 102.2050, "Pantai Klebang, Melaka"),
    (2.2320, 102.2000, "Jalan Klebang, Melaka"),
    # Ujong Pasir / Portuguese Settlement
    (2.1815, 102.2605, "Ujong Pasir, Melaka"),
    (2.1790, 102.2580, "Portuguese Settlement, Melaka"),
    # Sungai Udang
    (2.2850, 102.1620, "Pekan Sungai Udang, Melaka"),
    (2.2790, 102.1680, "Taman Sungai Udang, Melaka"),
    # Paya Rumput
    (2.2640, 102.2350, "Paya Rumput, Melaka"),
    (2.2595, 102.2400, "Jalan Paya Rumput, Melaka"),
    # Telok Mas
    (2.1725, 102.2690, "Telok Mas, Melaka"),
    (2.1680, 102.2650, "Taman Telok Mas, Melaka"),
    # Merlimau
    (2.1480, 102.4230, "Pekan Merlimau, Melaka"),
    (2.1520, 102.4185, "Jalan Merlimau, Melaka"),
    # Selandar
    (2.3350, 102.3820, "Pekan Selandar, Melaka"),
    (2.3410, 102.3770, "Jalan Selandar, Melaka"),
]

# ── Report Categories ─────────────────────────────────────────
CATEGORIES = [
    "Street Lighting",
    "Road Damage",
    "Waste",
    "Drainage",
    "Overgrown Vegetation",
    "Broken Sidewalk",
    "Fallen Tree",
    "Illegal Dumping",
    "Open Burning",
    "Vandalism",
    "Road Sign",
]

# Map categories to likely AI predictions
AI_PREDICTIONS = {
    "Street Lighting": "Street_Light",
    "Road Damage": "Pothole",
    "Waste": "Illegal_Dumping",
    "Drainage": "Drainage",
    "Overgrown Vegetation": "Overgrown_Vegetation",
    "Broken Sidewalk": "Broken_Sidewalk",
    "Fallen Tree": "Fallen_Tree",
    "Illegal Dumping": "Illegal_Dumping",
    "Open Burning": "Open_Burning",
    "Vandalism": "Vandalism",
    "Road Sign": "Road_Sign",
}

# Map categories to departments
DEPT_ASSIGNMENT = {
    "Street Lighting": "MBMB (Majlis Bandaraya Melaka Bersejarah)",
    "Road Damage": "JKR (Jabatan Kerja Raya Melaka)",
    "Waste": "SWCorp (SWCorp Malaysia)",
    "Drainage": "JKR (Jabatan Kerja Raya Melaka)",
    "Overgrown Vegetation": "MBMB (Majlis Bandaraya Melaka Bersejarah)",
    "Broken Sidewalk": "MBMB (Majlis Bandaraya Melaka Bersejarah)",
    "Fallen Tree": "MBMB (Majlis Bandaraya Melaka Bersejarah)",
    "Illegal Dumping": "SWCorp (SWCorp Malaysia)",
    "Open Burning": "SWCorp (SWCorp Malaysia)",
    "Vandalism": "MBMB (Majlis Bandaraya Melaka Bersejarah)",
    "Road Sign": "JKR (Jabatan Kerja Raya Melaka)",
}

# Realistic descriptions per category
DESCRIPTIONS = {
    "Street Lighting": [
        "Street light not working for 2 weeks. Very dark and unsafe at night.",
        "LED street lamp flickering on and off constantly, creating hazardous visibility.",
        "Fallen street light pole blocking part of the sidewalk. Electrical wires exposed.",
        "Broken street lamp near school zone. Children walking in the dark.",
        "Multiple street lights out on this entire stretch of road.",
    ],
    "Road Damage": [
        "Deep pothole causing vehicles to swerve dangerously into oncoming traffic.",
        "Large crack spanning across both lanes. Getting worse with rain.",
        "Road surface completely eroded after recent heavy rain. Very dangerous.",
        "Multiple potholes at junction causing accidents. Urgent repair needed.",
        "Road subsidence near drain cover. Dangerous for motorcycles.",
    ],
    "Waste": [
        "Garbage not collected for 5 days. Overflowing bins attracting stray animals.",
        "Bulk waste dumped at roadside. Mattress, furniture, and bags of trash.",
        "Commercial waste bins overflowing onto the main road. Health hazard.",
        "Household waste scattered by stray dogs. Needs immediate cleanup.",
        "Waste collection truck missed this taman for 3 consecutive days.",
    ],
    "Drainage": [
        "Clogged drain causing water to pool on the road during rain.",
        "Broken drainage cover on sidewalk. Pedestrian safety hazard.",
        "Storm drain overflow flooding the residential area every time it rains.",
        "Drainage system backing up into residential compound.",
        "Blocked monsoon drain with debris and trash buildup.",
    ],
    "Overgrown Vegetation": [
        "Overgrown bushes blocking visibility at T-junction. Accident risk.",
        "Tree branches hanging low over the road, hitting passing vehicles.",
        "Wild vegetation encroaching onto pedestrian walkway.",
        "Overgrown grass and weeds covering road signage.",
        "Unkempt vegetation harboring mosquito breeding grounds.",
    ],
    "Broken Sidewalk": [
        "Sidewalk tiles broken and uneven. Elderly residents tripping frequently.",
        "Large section of pavement crumbled. Wheelchair users cannot pass.",
        "Sidewalk collapsed near bus stop. Dangerous for commuters.",
        "Broken kerb stones along the main road walkway.",
        "Raised sidewalk slabs creating trip hazard near market.",
    ],
    "Fallen Tree": [
        "Large tree fell across the road after storm. Blocking traffic completely.",
        "Tree branch fallen on parked car. Owner requesting assistance.",
        "Dead tree leaning dangerously over children's playground.",
        "Uprooted tree blocking drainage and footpath after heavy winds.",
        "Fallen tree branch hanging on electrical cables. Fire hazard.",
    ],
    "Illegal Dumping": [
        "Construction waste illegally dumped at vacant lot. Ongoing problem.",
        "Electronic waste dumped near river bank. Environmental contamination risk.",
        "Illegal dumping of industrial waste behind residential area.",
        "Repeated illegal dumping of household renovation waste.",
        "Chemical containers dumped near water catchment area.",
    ],
    "Open Burning": [
        "Open burning of garden waste creating heavy smoke in residential area.",
        "Illegal open burning of trash near school. Children exposed to smoke.",
        "Repeated open burning at construction site. Air quality very poor.",
        "Agricultural waste burning spreading smoke across the highway.",
        "Open burning of plastic waste causing toxic fumes near houses.",
    ],
    "Vandalism": [
        "Public bench destroyed and graffiti on the walls of community hall.",
        "Bus stop shelter glass panels smashed. Safety concern.",
        "Park equipment vandalized. Swing set broken and slide damaged.",
        "Public phone booth destroyed. Street signage spray painted.",
        "Vandalized public toilet facilities at recreational park.",
    ],
    "Road Sign": [
        "Stop sign knocked down at busy intersection. Accident risk.",
        "Road sign faded and unreadable. Confusing for drivers.",
        "Speed limit sign bent and facing wrong direction.",
        "Missing road name sign at junction. GPS confusion for drivers.",
        "Directional road sign damaged by vehicle. Needs replacement.",
    ],
}

# Titles per category
TITLES = {
    "Street Lighting": ["Broken Street Light", "Flickering Lamp", "Fallen Lamp Post", "Dark Road Lamp", "Street Light Outage"],
    "Road Damage": ["Deep Pothole", "Road Crack", "Eroded Road Surface", "Multiple Potholes", "Road Subsidence"],
    "Waste": ["Uncollected Garbage", "Bulk Waste Dump", "Overflowing Bins", "Scattered Waste", "Missed Collection"],
    "Drainage": ["Clogged Drain", "Broken Drain Cover", "Storm Drain Flood", "Drainage Backup", "Blocked Monsoon Drain"],
    "Overgrown Vegetation": ["Overgrown Bush", "Low Hanging Branches", "Wild Vegetation", "Grass Over Sign", "Mosquito Breeding"],
    "Broken Sidewalk": ["Broken Tiles", "Crumbled Pavement", "Collapsed Sidewalk", "Broken Kerb", "Trip Hazard"],
    "Fallen Tree": ["Fallen Tree on Road", "Branch on Car", "Leaning Dead Tree", "Uprooted Tree", "Branch on Cables"],
    "Illegal Dumping": ["Construction Waste", "E-Waste Dump", "Industrial Waste", "Renovation Waste", "Chemical Dump"],
    "Open Burning": ["Garden Waste Burning", "Trash Burning Near School", "Construction Burning", "Farm Waste Burning", "Plastic Burning"],
    "Vandalism": ["Graffiti & Damage", "Bus Stop Smashed", "Park Vandalized", "Phone Booth Destroyed", "Toilet Vandalized"],
    "Road Sign": ["Stop Sign Down", "Faded Sign", "Bent Speed Sign", "Missing Name Sign", "Damaged Direction Sign"],
}

# Use existing uploaded images (pick a good variety from the uploads folder)
EXISTING_IMAGES = [
    "uploads/01dcf303-5d18-4d04-901e-47710a911dad.jpg",
    "uploads/067beb81-aa38-4875-8302-0f0f876a7588.jpg",
    "uploads/0875155a-9c73-4a91-a1d8-b9f8645ff1d9.jpg",
    "uploads/191037f6-c48f-4368-8ab3-6c9ac54d2e90.jpg",
    "uploads/219e8d25-cfdd-421a-843b-3485a928146a.jpg",
    "uploads/31dfbbf5-5685-49b9-9d63-131093e32f95.jpg",
    "uploads/34677595-c1d9-4fec-8df6-151218e66418.jpg",
    "uploads/35c1fa2b-4b88-4be5-ba87-0bcf7af2611e.png",
    "uploads/5362d52e-27fc-424d-96d1-85b73f489715.jpg",
    "uploads/5b6a4bbc-f168-4431-aff8-36445cafc524.jpg",
    "uploads/606e2bef-dbe0-4071-b188-02f969ead250.webp",
    "uploads/6e6e5c4b-9adc-4731-a2a8-4585179d7bf2.jpg",
    "uploads/787207c4-ab94-4a1e-bb32-5141564f971b.jpg",
    "uploads/7ef34019-c803-4d2b-9ec9-57eec4386aa0.jpg",
    "uploads/92c9384e-99db-4a4b-bb68-591a9387acbb.jpg",
    "uploads/97f1b732-d50a-49fc-a8e2-40fa86d4ae3c.jpg",
    "uploads/af30f21b-3909-4363-a26b-234227986b81.png",
    "uploads/c30418c7-6d50-4765-afc7-84c89aa4d7f1.png",
    "uploads/c9bad6b6-3069-4261-b62e-4be2146138ce.jpg",
    "uploads/cf528fb5-395c-463b-9017-82e7c72639b1.jpg",
    "uploads/d109eece-d094-48f8-9c39-1e925a936f26.png",
    "uploads/e6b98283-4e2d-4854-bc1e-371409298a3c.jpg",
    "uploads/ebab1a7c-d550-4cdf-99f3-9ed33877474b.jpg",
    "uploads/fff147ee-40c4-42ef-8d35-9f5635937185.jpg",
]

# Statuses with weighted distribution
STATUS_WEIGHTS = [
    ("Pending", 15),
    ("In Review", 8),
    ("In Process", 8),
    ("In Maintenance", 7),
    ("Resolved", 10),
    ("Rejected", 2),
]

WORKERS = ["worker", "worker1", "worker2"]

def random_status():
    pool = []
    for s, w in STATUS_WEIGHTS:
        pool.extend([s] * w)
    return random.choice(pool)


def random_timestamp_within_days(days=60):
    """Generate a random timestamp within the past N days."""
    offset = random.randint(0, days * 24 * 60)  # minutes
    dt = datetime.now(timezone.utc) - timedelta(minutes=offset)
    return dt


def main():
    db = Session()
    try:
        # ── Step 1: Delete all existing reports ──
        print("Deleting all existing reports...")
        db.execute(text('DELETE FROM "report_upvotes"'))
        db.execute(text('DELETE FROM "Issue"'))
        db.execute(text('DELETE FROM "AuthorityAction"'))
        db.execute(text('DELETE FROM "Complaint"'))
        db.commit()
        print("All existing reports deleted.")

        # ── Step 2: Get the citizen user ID ──
        result = db.execute(text('SELECT "userID" FROM "User" LIMIT 1')).fetchone()
        if not result:
            print("ERROR: No citizen user found in User table. Run the backend first to seed users.")
            return
        citizen_id = result[0]
        print(f"Using citizen user ID: {citizen_id}")

        # ── Step 3: Seed 50 reports ──
        print("\nSeeding 50 reports across Melaka...")
        
        for i in range(50):
            loc = MELAKA_LOCATIONS[i % len(MELAKA_LOCATIONS)]
            lat, lng, address = loc
            
            # Add slight random offset to coordinates (within ~100m)
            lat += random.uniform(-0.001, 0.001)
            lng += random.uniform(-0.001, 0.001)
            
            category = random.choice(CATEGORIES)
            status = random_status()
            timestamp = random_timestamp_within_days(60)
            confidence = f"{random.randint(75, 99)}%"
            image = random.choice(EXISTING_IMAGES)
            title = random.choice(TITLES[category])
            description = random.choice(DESCRIPTIONS[category])
            ai_pred = AI_PREDICTIONS[category]
            upvotes = random.randint(0, 25)
            
            # Set workflow fields based on status
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
                reviewed_at = (timestamp + timedelta(hours=random.randint(1, 24))).isoformat()
                forwarded_at = reviewed_at
                authority_notes = f"Report verified. Forwarded to {assigned_dept.split(' ')[0]}."
                
            if status in ("In Process", "In Maintenance", "Resolved"):
                assigned_worker = random.choice(WORKERS)
                in_process_at = (timestamp + timedelta(hours=random.randint(24, 72))).isoformat()
                
            if status in ("In Maintenance", "Resolved"):
                in_maintenance_at = (timestamp + timedelta(hours=random.randint(72, 120))).isoformat()
                
            if status == "Resolved":
                resolved_at = (timestamp + timedelta(hours=random.randint(120, 240))).isoformat()
                
            if status == "Rejected":
                authority_notes = "Duplicate report / Invalid submission."

            # Get location postcode area
            location = f"{random.randint(75000, 78000)}, Melaka, Malaysia"

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
            
            print(f"  [{i+1:02d}] {status:15s} | {category:22s} | {address[:40]}")

        db.commit()
        
        # ── Step 4: Verify ──
        count = db.execute(text('SELECT COUNT(*) FROM "Complaint"')).scalar()
        print(f"\n{'='*60}")
        print(f"  Done! {count} reports seeded successfully.")
        print(f"{'='*60}")
        
        # Status summary
        rows = db.execute(text('SELECT "status", COUNT(*) FROM "Complaint" GROUP BY "status" ORDER BY COUNT(*) DESC')).fetchall()
        print("\nStatus breakdown:")
        for row in rows:
            print(f"  {row[0]:18s} → {row[1]} reports")

    except Exception as e:
        db.rollback()
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    main()
