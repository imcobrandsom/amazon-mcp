-- ══════════════════════════════════════════════════════════════════════════════
-- Seed: Bol.com Content Examples for AI Training
-- Categories: Sportlegging, Sport-BHS, Laptops
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO content_examples (marketplace, category_slug, example_type, language, content, reason, rating, created_by) VALUES

-- ══════════════════════════════════════════════════════════════════════════════
-- SPORTLEGGING EXAMPLES
-- ══════════════════════════════════════════════════════════════════════════════

-- GOOD TITLES
('bol', 'sportlegging', 'good_title', 'nl',
 'Nike Dri-FIT Fast Sportlegging Dames - High Waist - Zwart - Maat M - Hardlopen & Yoga',
 'Merk + producttype + technologie + doelgroep + USP + kleur + maat + gebruik. Natuurlijk leesbaar, 88 tekens, 5 keywords geïntegreerd.',
 5, 'system'),

('bol', 'sportlegging', 'good_title', 'nl',
 'Adidas Techfit Dames Sportlegging - 7/8 Lengte - Grijs Gemêleerd - XS - Compressie & Ondersteuning',
 'Duidelijke structuur: merk, model, doelgroep, lengte-detail, kleur, maat, functionele USP.',
 5, 'system'),

-- BAD TITLES
('bol', 'sportlegging', 'bad_title', 'nl',
 'LEGGING SPORT ZWART YOGA DAMES FITNESS HARDLOPEN NIKE',
 'ALL CAPS, keyword stuffing zonder structuur, niet leesbaar voor mensen, slechte gebruikerservaring.',
 1, 'system'),

('bol', 'sportlegging', 'bad_title', 'nl',
 'Legging zwart',
 'Te kort (14 tekens), geen merk, geen maat, geen USP, geen context. Gemiste SEO kans.',
 1, 'system'),

-- GOOD DESCRIPTIONS
('bol', 'sportlegging', 'good_description', 'nl',
 '<p>De <strong>Nike Dri-FIT Fast Sportlegging</strong> combineert comfort en prestaties voor intensieve workouts.</p>
<ul>
  <li><strong>Vocht-afvoerende stof:</strong> Dri-FIT technologie houdt je droog tijdens sporten</li>
  <li><strong>High waist design:</strong> Extra ondersteuning en flattering pasvorm</li>
  <li><strong>Ademend materiaal:</strong> Mesh panelen voor ventilatie op warme plekken</li>
  <li><strong>Zak aan achterzijde:</strong> Veilige opslag voor telefoon of sleutels</li>
</ul>
<p>Perfecte pasvorm voor hardlopen, yoga, fitness of CrossFit. Verkrijgbaar in maten XS t/m XXL.</p>',
 'HTML structuur, intro + 4 USP bullets + afsluiting. Keywords natuurlijk geïntegreerd (sporten, high waist, ademend, hardlopen, yoga, fitness). Technologie uitgelegd (Dri-FIT). Praktische details (zak). 371 tekens.',
 5, 'system'),

-- BAD DESCRIPTIONS
('bol', 'sportlegging', 'bad_description', 'nl',
 'Zwarte sportlegging. Leuk voor sport.',
 'Te kort (40 tekens), geen USPs, geen technische details, geen meerwaarde boven titel.',
 1, 'system'),

-- ══════════════════════════════════════════════════════════════════════════════
-- SPORT-BHS EXAMPLES
-- ══════════════════════════════════════════════════════════════════════════════

-- GOOD TITLES
('bol', 'sport-bhs', 'good_title', 'nl',
 'Under Armour Mid Impact Sport-BH Dames - Beugelloos - Zwart - Maat S - Fitness & CrossFit',
 'Merk + impact level + product + doelgroep + feature + kleur + maat + gebruik.',
 5, 'system'),

('bol', 'sport-bhs', 'good_title', 'nl',
 'Adidas High Support Sport-BH Dames - Verstelbare Bandjes - Grijs - M - Hardlopen & HIIT',
 'Merk + support level + product + doelgroep + USP feature + kleur + maat + specifiek gebruik.',
 5, 'system'),

-- BAD TITLES
('bol', 'sport-bhs', 'bad_title', 'nl',
 'BH SPORT ZWART',
 'Te kort, geen merk, geen maat, geen impact level (cruciaal voor sport-bhs).',
 1, 'system'),

('bol', 'sport-bhs', 'bad_title', 'nl',
 'Sport-BH voor dames in verschillende kleuren en maten',
 'Te generiek, geen specifieke kleur/maat, geen merk, geen support level. Niet bruikbaar voor product page.',
 1, 'system'),

-- ══════════════════════════════════════════════════════════════════════════════
-- ELEKTRONICA / LAPTOPS EXAMPLES (different focus: specs not fit)
-- ══════════════════════════════════════════════════════════════════════════════

-- GOOD TITLES
('bol', 'laptops', 'good_title', 'nl',
 'HP Pavilion 15-eh2035nd - Laptop - 15.6" FHD - AMD Ryzen 5 - 8GB RAM - 512GB SSD - Windows 11',
 'Merk + model + producttype + schermgrootte + resolutie + processor + RAM + opslag + OS. Alle key specs in titel.',
 5, 'system'),

('bol', 'laptops', 'good_title', 'nl',
 'Lenovo IdeaPad 3 - 14" Full HD Laptop - Intel i5-1235U - 16GB DDR4 - 512GB SSD - Windows 11 Home',
 'Merk + model + schermgrootte + resolutie + processor met generatie + RAM type + opslag + OS versie.',
 5, 'system'),

-- BAD TITLES
('bol', 'laptops', 'bad_title', 'nl',
 'Laptop HP 15 inch',
 'Te weinig specs, geen processor, geen RAM, geen opslag info. Kopers kunnen niet vergelijken.',
 1, 'system'),

('bol', 'laptops', 'bad_title', 'nl',
 'HP Laptop met Windows',
 'Extreem weinig info, geen schermgrootte, geen specs. Onbruikbaar voor koopbeslissing.',
 1, 'system'),

-- GOOD DESCRIPTIONS
('bol', 'laptops', 'good_description', 'nl',
 '<p>De <strong>HP Pavilion 15-eh2035nd</strong> is een krachtige laptop voor dagelijks gebruik, studie en licht entertainment.</p>
<ul>
  <li><strong>AMD Ryzen 5 processor:</strong> Soepele multitasking en snelle prestaties</li>
  <li><strong>8GB DDR4 RAM:</strong> Voldoende geheugen voor Chrome, Office en videobellen tegelijk</li>
  <li><strong>512GB SSD:</strong> Snelle opstart (< 10 sec) en ruim voor bestanden/foto''s</li>
  <li><strong>15.6" Full HD scherm:</strong> Helder IPS-paneel met brede kijkhoeken</li>
  <li><strong>Windows 11 Home:</strong> Nieuwste OS met 1 jaar garantie</li>
</ul>
<p>Geschikt voor thuiswerken, Netflix, licht fotobewerken. Accu: ~7 uur gemengd gebruik. HDMI, USB-C en 2x USB-A poorten.</p>',
 'Focus op specs + praktische context (wat kun je ermee). Technische termen uitgelegd (SSD snelheid, RAM gebruik). Garantie/accu info. Connectiviteit genoemd.',
 5, 'system'),

-- BAD DESCRIPTIONS
('bol', 'laptops', 'bad_description', 'nl',
 'Mooie laptop voor werk en studie.',
 'Te kort (35 tekens), geen specs, geen praktische info, geen USPs. Geen toegevoegde waarde.',
 1, 'system');
