"""Word pools and catalogues. Everything here is invented; real Finnish place names are used only for realism."""

# region -> cities (name, lat, lon, weight), region weight (rough population share)
REGIONS = [
    ("Uusimaa", [("Helsinki", 60.17, 24.94, 6), ("Espoo", 60.21, 24.66, 3), ("Vantaa", 60.29, 25.04, 3), ("Porvoo", 60.39, 25.66, 1), ("Lohja", 60.25, 24.07, 1)], 30),
    ("Southwest Finland", [("Turku", 60.45, 22.27, 5), ("Salo", 60.38, 23.13, 1), ("Rauma", 61.13, 21.51, 1), ("Naantali", 60.47, 22.02, 1), ("Uusikaupunki", 60.80, 21.41, 1)], 9),
    ("Pirkanmaa", [("Tampere", 61.50, 23.76, 5), ("Nokia", 61.48, 23.51, 1), ("Ylöjärvi", 61.55, 23.60, 1), ("Valkeakoski", 61.27, 24.03, 1), ("Sastamala", 61.34, 22.91, 1)], 9),
    ("Päijät-Häme", [("Lahti", 60.98, 25.66, 4), ("Heinola", 61.20, 26.04, 1), ("Hollola", 60.99, 25.52, 1)], 4),
    ("Kymenlaakso", [("Kotka", 60.47, 26.95, 2), ("Kouvola", 60.87, 26.70, 2), ("Hamina", 60.57, 27.20, 1)], 3),
    ("South Karelia", [("Lappeenranta", 61.06, 28.19, 3), ("Imatra", 61.17, 28.77, 1)], 2.5),
    ("North Savo", [("Kuopio", 62.89, 27.68, 4), ("Iisalmi", 63.56, 27.19, 1)], 4.5),
    ("Central Finland", [("Jyväskylä", 62.24, 25.75, 4), ("Äänekoski", 62.60, 25.73, 1), ("Jämsä", 61.86, 25.19, 1)], 5),
    ("Ostrobothnia", [("Vaasa", 63.10, 21.62, 3), ("Seinäjoki", 62.79, 22.84, 2), ("Kokkola", 63.84, 23.13, 1)], 6),
    ("North Ostrobothnia", [("Oulu", 65.01, 25.47, 5), ("Raahe", 64.68, 24.48, 1), ("Kuusamo", 65.97, 29.19, 1), ("Ylivieska", 64.07, 24.53, 1)], 8),
    ("Kainuu", [("Kajaani", 64.23, 27.73, 2), ("Sotkamo", 64.13, 28.39, 1)], 1.5),
    ("Lapland", [("Rovaniemi", 66.50, 25.73, 3), ("Kemi", 65.74, 24.56, 2), ("Kemijärvi", 66.71, 27.43, 1), ("Sodankylä", 67.42, 26.59, 1), ("Ivalo", 68.66, 27.54, 1)], 3.5),
]
CORE_CITIES = ["Helsinki", "Tampere", "Oulu"]
CITY_CODES = {"Turku": "TKU", "Oulu": "OUL", "Tampere": "TMP", "Helsinki": "HEL", "Jyväskylä": "JKL", "Rovaniemi": "ROV", "Kemijärvi": "KMJ", "Sodankylä": "SOD"}

SUBURB_ROOTS = ["Koski", "Harju", "Niemi", "Mäki", "Salmi", "Ranta", "Pelto", "Metsä", "Kallio", "Lehto", "Kangas", "Vuori", "Lampi", "Saari", "Kylä", "Santa", "Tuuli", "Rinne", "Aho", "Honka", "Kuusi", "Koivu", "Pihlaja", "Tammi"]
SUBURB_SUFFIXES = ["la", "mäki", "niemi", "harju", "kylä", "lahti", "ranta", "kumpu", "vaara", "salo", "nummi", "tie", ""]

# type -> (id prefix, [(model, first_year, last_year, firmware lines, oldest first)])
CATALOGUE = {
    "transmission_node": ("TRN", [("TX-2000", 2009, 2017, ["2.1", "2.4", "3.0"]), ("TX-3000", 2015, 2022, ["3.8", "4.0", "4.2"]), ("TX-5000", 2021, 2026, ["5.0", "5.1", "5.3"])]),
    "router": ("RTR", [("RT-9", 2014, 2024, ["7.2", "7.9", "8.3"]), ("RT-12", 2022, 2026, ["9.0", "9.2"])]),
    "aggregation_switch": ("AGG", [("AGG-7", 2012, 2026, ["1.4", "2.0", "2.3"])]),
    "radio_unit": ("RAD", [("RU-200", 2012, 2021, ["1.8", "2.2", "2.6"]), ("RU-400", 2019, 2026, ["3.1", "3.4", "4.0"])]),
    "microwave_terminal": ("MWT", [("MW-E80", 2014, 2026, ["1.2", "1.6", "2.1"])]),
    "baseband_unit": ("BBU", [("BBU-5", 2017, 2026, ["20.1", "21.4", "22.0"])]),
    "power_system": ("PWR", [("PWR-48", 2008, 2026, [""])]),
}

FIRST_NAMES = """Aino Aleksi Anni Antti Eero Elias Emilia Essi Hanna Heikki Helmi Henri Iida Ilkka Jaakko Janne Jari Johanna Jonna Juha Jukka Julia Kaisa Kalle Katja Kimmo Kirsi Lauri Leena Liisa Lotta Maija Marko Matti Minna Mikko Niko Noora Olli Outi Pasi Petra Pekka Raimo Ritva Sanna Sari Selma Severi Sini Susanna Tapio Teemu Tiina Timo Tuomas Ulla Vesa Veikko Venla Ville Aapo Eino Ida Joel Mari Oona Rasmus Sofia Tuuli Unto Vilma Väinö Åsa""".split()
LAST_NAMES = """Aaltonen Heikkinen Hirvonen Hämäläinen Jokinen Kinnunen Korhonen Koskinen Laaksonen Lahtinen Lehtonen Leinonen Mäkinen Nieminen Ojala Rantanen Salminen Savolainen Tuominen Turunen Virtanen Väisänen Karjalainen Kallio Hakala Halonen Heinonen Järvinen Kemppainen Laine Lindholm Manninen Miettinen Mattila Nurmi Pesonen Pitkänen Rautio Salo Seppälä Toivonen Vainio Huttunen Honkanen Kokkonen Koivisto Lammi Lappalainen Peltonen Räsänen Sirola Tikkanen Varis Immonen Kauppinen Eskola Marttila Suominen Hyvönen Oksanen Taipale Hietala""".split()

# team -> (share of staff, [(role, weight)], one group per region?, technical?)
TEAMS = {
    "NOC": (0.08, [("NOC Operator", 6), ("NOC Shift Lead", 1)], False, True),
    "Transmission": (0.07, [("Network Expert", 3), ("Transmission Engineer", 7)], False, True),
    "Radio": (0.06, [("Radio Specialist", 3), ("Radio Engineer", 7)], False, True),
    "Core & IP": (0.06, [("IP Engineer", 8), ("Network Expert", 2)], False, True),
    "Field team": (0.24, [("Field Engineer", 8), ("Junior Field Engineer", 3), ("Field Team Lead", 1)], True, True),
    "Logistics": (0.04, [("Site Access Coordinator", 2), ("Parts Coordinator", 3)], True, False),
    "Planning": (0.04, [("Network Architect", 3), ("Capacity Planner", 5)], False, True),
    "Customer service": (0.14, [("Customer Service Agent", 9), ("Customer Service Lead", 1)], True, False),
    "Sales": (0.10, [("Sales Representative", 8), ("Account Manager", 2)], True, False),
    "Facilities": (0.04, [("Building Caretaker", 3), ("Office Manager", 1)], True, False),
    "IT": (0.04, [("IT Support", 1)], False, False),
    "Vendor management": (0.02, [("Vendor Manager", 1)], False, False),
    "Security": (0.02, [("Security Officer", 1)], False, False),
    "Management": (0.05, [("Regional Manager", 1)], True, False),
}
SENIORITY = [("junior", 0.25, (0, 3)), ("mid", 0.40, (3, 8)), ("senior", 0.25, (8, 18)), ("expert", 0.10, (15, 32))]
STYLES = ["terse", "chatty", "formal", "emoji", "finglish"]
VENDORS = ["Nordwave", "Kaleva Optics", "Aurora Networks", "Lumo Systems", "Polar Radio"]
