import os
import json
import requests
import time

# Opdateret URL (som du allerede har fikset)
API_BASE = "https://squid-api.tjek.com/v2"
OUTPUT_DIR = "danish_catalogs_dataset"
IMAGES_DIR = os.path.join(OUTPUT_DIR, "images")

os.makedirs(IMAGES_DIR, exist_ok=True)

# Kun supermarkeder (du kan tilføje flere her)
SUPERMARKETS = ["Netto", "REMA 1000", "føtex", "Bilka", "SuperBrugsen", "Kvickly", "365discount", "MENY", "SPAR", "Lidl"]

coco_format = {
    "info": {"description": "Danish Supermarket Catalogs", "version": "2.0"},
    "images": [],
    "annotations": [],
    "categories": [{"id": 1, "name": "product_offer", "supercategory": "catalog_item"}]
}

def main():
    print("Henter aktive tilbudsaviser...")
    
    # Henter 100 aviser (i stedet for 3)
    catalogs_req = requests.get(f"{API_BASE}/catalogs?limit=100")
    if catalogs_req.status_code != 200:
        print(f"Fejl ved hentning af aviser: {catalogs_req.status_code}")
        return
        
    catalogs = catalogs_req.json()
    image_id_counter = 1
    annotation_id_counter = 1

    for catalog in catalogs:
        cat_id = catalog.get("id")
        dealer_name = catalog.get("dealer", {}).get("name", "Unknown")
        
        # Spring over, hvis det ikke er et supermarked (f.eks. Jysk, Elgiganten)
        if not any(supermarket.lower() in dealer_name.lower() for supermarket in SUPERMARKETS):
            continue

        dim = catalog.get("dimensions", {})
        base_width = dim.get("width", 1000)
        base_height = dim.get("height", 1400) 

        print(f"\nBehandler: {dealer_name} (ID: {cat_id})")

        # 1. Hent Billeder
        pages_req = requests.get(f"{API_BASE}/catalogs/{cat_id}/pages")
        if pages_req.status_code != 200:
            print(f" -> Kunne ikke hente sider for {dealer_name}")
            continue
            
        pages = pages_req.json()
        page_to_image_id = {}

        for page_index, page_data in enumerate(pages):
            page_num = str(page_index + 1)
            img_url = page_data.get("zoom") or page_data.get("view")
            
            if not img_url:
                continue

            file_name = f"{dealer_name.lower().replace(' ', '_')}_{cat_id}_pg{page_num}.jpg"
            file_path = os.path.join(IMAGES_DIR, file_name)

            # Download kun, hvis vi ikke allerede har den
            if not os.path.exists(file_path):
                img_data = requests.get(img_url).content
                with open(file_path, 'wb') as f:
                    f.write(img_data)
                time.sleep(0.2) # Lille pause for at undgå at blive blokeret

            coco_format["images"].append({
                "id": image_id_counter,
                "file_name": file_name,
                "width": base_width,
                "height": base_height,
                "retailer": dealer_name
            })
            
            page_to_image_id[page_num] = image_id_counter
            image_id_counter += 1

        # 2. Hent Hotspots (Bounding boxes)
        hotspots_req = requests.get(f"{API_BASE}/catalogs/{cat_id}/hotspots")
        if hotspots_req.status_code != 200:
            print(f" -> FEJL: API afviste hotspot-data (Status {hotspots_req.status_code}). Mangler du API-nøgle?")
            continue
            
        hotspots = hotspots_req.json()
        
        if not hotspots:
            print(" -> Ingen hotspots (produkter) fundet i denne avis.")

        for hotspot in hotspots:
            locations = hotspot.get("locations", {})
            product_name = hotspot.get("offer", {}).get("heading", "Ukendt produkt")

            for page_num, polygon in locations.items():
                if page_num not in page_to_image_id:
                    continue
                
                try:
                    x_coords = [pt[0] for pt in polygon]
                    y_coords = [pt[1] for pt in polygon]

                    xmin, ymin = min(x_coords), min(y_coords)
                    xmax, ymax = max(x_coords), max(y_coords)

                    # Konverter fra relativ (0-1) til rigtige pixels
                    x_px = xmin * base_width
                    y_px = ymin * base_height
                    w_px = (xmax - xmin) * base_width
                    h_px = (ymax - ymin) * base_height
                    area = w_px * h_px

                    coco_format["annotations"].append({
                        "id": annotation_id_counter,
                        "image_id": page_to_image_id[page_num],
                        "category_id": 1,
                        "bbox": [round(x_px, 2), round(y_px, 2), round(w_px, 2), round(h_px, 2)],
                        "area": round(area, 2),
                        "iscrowd": 0,
                        "product_name": product_name
                    })
                    annotation_id_counter += 1
                except Exception as e:
                    print(f" -> Kunne ikke læse koordinater for et produkt: {e}")

    # 3. Gem den færdige JSON
    json_path = os.path.join(OUTPUT_DIR, "annotations_coco.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(coco_format, f, indent=2, ensure_ascii=False)
    
    print("\n---------------------------------------------------")
    print(f"Færdig! Datasæt gemt i mappen: {OUTPUT_DIR}")
    print(f"Billeder downloadet: {len(coco_format['images'])}")
    print(f"Bounding boxes fundet: {len(coco_format['annotations'])}")
    print("---------------------------------------------------")

if __name__ == "__main__":
    main()