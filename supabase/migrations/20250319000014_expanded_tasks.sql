-- 014: Replace seed tasks with comprehensive vineyard task list
-- Null out task references in time_entries before deleting
UPDATE time_entries SET task_id = NULL WHERE task_id IS NOT NULL;
DELETE FROM tasks;

INSERT INTO tasks (name, aliases, category) VALUES
-- Canopy Management
('Basal Leaf Removal', ARRAY['early leaf pull', 'fruit zone leaf removal', 'deshojar temprano', 'quitar hojas de abajo'], 'canopy'),
('Canopy Thinning', ARRAY['thinning canopy', 'opening canopy', 'aclareo de canopia', 'abrir canopia'], 'canopy'),
('Cluster Thinning', ARRAY['crop thinning', 'dropping fruit', 'green drop', 'crop drop', 'tirar racimos', 'ralear', 'aclareo de racimos', 'tirar fruta'], 'canopy'),
('Cluster Wing Removal', ARRAY['removing shoulders', 'wing thinning', 'quitar alas del racimo', 'cortar hombros'], 'canopy'),
('Deleafing (Hand)', ARRAY['leaf pulling', 'pulling leaves', 'hand deleafing', 'deshoje', 'deshojar', 'quitar hojas', 'sacar hoja', 'deshoje a mano', 'leaf pull', 'defoliation'], 'canopy'),
('Deleafing (Machine)', ARRAY['mechanical leaf removal', 'machine deleafing', 'deshojar con maquina'], 'canopy'),
('Disbudding', ARRAY['removing buds', 'rubbing off buds', 'desyemar', 'quitar yemas'], 'canopy'),
('Green Harvest', ARRAY['vendange verte', 'crop drop', 'dropping green fruit', 'vendimia en verde', 'tirar fruta verde', 'cosecha verde'], 'canopy'),
('Hedging (Machine)', ARRAY['mechanical hedging', 'topping', 'summer trim', 'despuntar', 'recortar', 'hedgear'], 'canopy'),
('Hedging (Hand)', ARRAY['hand topping', 'cutting tops', 'trimming shoots', 'despuntar a mano', 'cortar puntas'], 'canopy'),
('Lateral Shoot Removal', ARRAY['removing laterals', 'secondary shoot removal', 'quitar laterales', 'sacar brotes secundarios'], 'canopy'),
('Shoot Positioning', ARRAY['combing shoots', 'vertical shoot positioning', 'VSP', 'peinar brotes', 'acomodar brotes', 'posicionar', 'levantar brotes'], 'canopy'),
('Shoot Thinning', ARRAY['thinning shoots', 'removing extra shoots', 'desbrote', 'ralear brotes', 'sacar brotes', 'quitar chupones', 'entresacar'], 'canopy'),
('Suckering', ARRAY['desuckering', 'removing suckers', 'trunk suckering', 'despampanar', 'sacar chupones', 'quitar mamones', 'desmamonar', 'chuponear', 'sucker'], 'canopy'),
('Tucking', ARRAY['tucking shoots', 'pushing shoots between wires', 'wire tucking', 'acomodar brotes entre alambres', 'meter brotes', 'tuckar'], 'canopy'),
('Tying (Green)', ARRAY['green tying', 'shoot tying', 'tying new growth', 'amarrar brotes verdes', 'atar brotes', 'amarrar lo verde'], 'canopy'),
('Veraison Thinning', ARRAY['green cluster removal at veraison', 'tirar racimos verdes en envero', 'ralear en envero'], 'canopy'),

-- Pruning
('Dormant Pruning', ARRAY['winter pruning', 'cane pruning', 'spur pruning', 'hand pruning', 'pruning', 'podar', 'poda', 'poda de invierno', 'poda en seco', 'cortar vara'], 'pruning'),
('Pre-Pruning (Machine)', ARRAY['mechanical pre-pruning', 'cutter bar', 'rough cut', 'pre-poda', 'pre-podar con maquina'], 'pruning'),
('Brush Removal', ARRAY['pulling brush', 'dragging brush', 'clearing canes', 'sacar vara', 'jalar leña', 'limpiar vara', 'tirar ramas'], 'pruning'),
('Brush Chipping', ARRAY['chipping', 'mulching brush', 'running the chipper', 'picar ramas', 'chipear', 'triturar', 'shredding'], 'pruning'),
('Wound Sealing', ARRAY['painting cuts', 'trunk paint', 'pintar cortes', 'sellar heridas', 'pintar troncos'], 'pruning'),

-- Vine Training and Trellising
('Catch Wire Raising', ARRAY['raising wires', 'lifting wires', 'moving wires', 'lowering wires', 'subir alambres', 'levantar alambres', 'bajar alambres'], 'trellising'),
('End Post Installation', ARRAY['setting end posts', 'driving anchors', 'installing anchors', 'poner postes de ancla', 'clavar anclas'], 'trellising'),
('Post Driving', ARRAY['pounding posts', 'driving stakes', 'setting posts', 'clavar postes', 'meter postes', 'poner estacas', 'postear'], 'trellising'),
('Post Replacement', ARRAY['replacing broken posts', 'swapping posts', 'cambiar postes', 'reemplazar postes'], 'trellising'),
('Trellis Construction', ARRAY['building trellis', 'setting up trellis', 'construir espaldera', 'armar sistema'], 'trellising'),
('Trellis Repair', ARRAY['fixing trellis', 'restringing wire', 'tightening wire', 'arreglar espaldera', 'componer alambre', 'tensar alambre', 'wire work', 'reparación de espalderas'], 'trellising'),
('Tying (Canes)', ARRAY['tying down', 'cane tying', 'bow tying', 'tapener', 'Max gun', 'amarrar', 'atar varas', 'amarrar con tapener', 'poner ligas', 'usar la pistola'], 'trellising'),
('Training Young Vines', ARRAY['selecting trunk', 'training to wire', 'establishing vine', 'formar planta', 'entrenar vid', 'guiar al alambre'], 'trellising'),
('Trunk Renewal', ARRAY['retraining vine', 'laying down new trunk', 'renovar tronco', 'entrenar tronco nuevo'], 'trellising'),
('Wire Stringing', ARRAY['running wire', 'stringing wire', 'pulling wire', 'putting up wire', 'correr alambre', 'poner alambre', 'jalar alambre', 'alambrar'], 'trellising'),

-- Harvest and Picking
('Harvest (Hand)', ARRAY['picking', 'hand harvest', 'cutting grapes', 'grape picking', 'harvesting', 'cosecha', 'pizca', 'cortar uva', 'cosechar', 'vendimia', 'pizcar', 'harvest'], 'harvest'),
('Harvest (Machine)', ARRAY['machine harvest', 'mechanical picking', 'cosecha mecanica', 'pizca con maquina'], 'harvest'),
('Harvest (Night)', ARRAY['night pick', 'cool harvest', 'early morning pick', 'pizca de noche', 'cosecha nocturna', 'cortar de madrugada'], 'harvest'),
('Berry Sampling', ARRAY['brix testing', 'sugar testing', 'checking brix', 'sampling', 'muestreo', 'checar brix', 'sacar muestras'], 'harvest'),
('Field Sorting', ARRAY['table sorting', 'removing MOG', 'sorting grapes', 'fruit sorting', 'seleccionar uva', 'escoger fruta'], 'harvest'),
('Yield Estimation', ARRAY['crop estimate', 'cluster count', 'berry weight', 'estimacion de cosecha', 'contar racimos', 'estimar produccion'], 'harvest'),

-- Pest and Disease Management
('Spraying', ARRAY['spraying', 'running the sprayer', 'chemical application', 'fumigar', 'fumigación', 'echar producto', 'aplicar quimico', 'asperjar', 'rociar', 'spray'], 'pest_management'),
('Sulfur Dusting', ARRAY['dusting', 'sulfur application', 'powdered sulfur', 'tirar azufre', 'espolvorear azufre', 'azufrar'], 'pest_management'),
('Fungicide Application', ARRAY['spraying for mildew', 'aplicar fungicida', 'fumigar contra hongo'], 'pest_management'),
('Herbicide Application', ARRAY['weed spray', 'under-vine spray', 'Roundup', 'aplicar herbicida', 'fumigar hierba', 'matar maleza'], 'pest_management'),
('Insecticide Application', ARRAY['bug spray', 'spraying for leafhoppers', 'mealybug treatment', 'aplicar insecticida', 'fumigar contra insectos'], 'pest_management'),
('Disease Scouting', ARRAY['checking for mildew', 'powdery mildew scouting', 'botrytis check', 'revisar enfermedades', 'buscar mildiu'], 'pest_management'),
('Pest Scouting', ARRAY['vineyard walk', 'field check', 'general scouting', 'IPM monitoring', 'recorrer vinedo', 'checar el campo', 'rondines', 'scouting'], 'pest_management'),
('Bird Netting Installation', ARRAY['putting up nets', 'netting', 'covering with nets', 'poner malla', 'enmallar'], 'pest_management'),
('Bird Netting Removal', ARRAY['pulling nets', 'taking down nets', 'rolling up nets', 'quitar malla', 'recoger malla'], 'pest_management'),
('Rodent Control', ARRAY['gopher trapping', 'vole control', 'ground squirrel baiting', 'control de roedores', 'trampas de tuza'], 'pest_management'),
('Foliar Feeding', ARRAY['foliar spray', 'foliar application', 'nutrient spray', 'aplicacion foliar', 'fumigar hojas'], 'pest_management'),
('Dormant Spraying', ARRAY['dormant oil spray', 'lime sulfur', 'aplicar aceite dormante', 'fumigar en dormancia'], 'pest_management'),

-- Irrigation
('Irrigation', ARRAY['watering', 'running water', 'turning on water', 'riego', 'irrigación', 'regar'], 'irrigation'),
('Drip Line Installation', ARRAY['laying drip', 'installing drip tape', 'running drip line', 'poner manguera de goteo', 'instalar riego', 'tender linea'], 'irrigation'),
('Drip Line Repair', ARRAY['fixing drip line', 'patching leaks', 'arreglar manguera', 'reparar goteo', 'parchar manguera'], 'irrigation'),
('Drip System Flushing', ARRAY['flushing lines', 'blowing out lines', 'purgar lineas', 'limpiar sistema'], 'irrigation'),
('Emitter Repair', ARRAY['checking drippers', 'fixing emitters', 'unclogging drip', 'revisar goteros', 'limpiar goteros', 'destapar goteros'], 'irrigation'),
('Fertigation', ARRAY['injecting fertilizer', 'liquid feed through drip', 'fertilizar por goteo', 'inyectar fertilizante', 'fertigar'], 'irrigation'),
('Hand Watering', ARRAY['bucket watering', 'spot watering', 'watering new plants', 'regar a mano', 'dar agua con cubeta'], 'irrigation'),

-- Soil and Ground Work
('Mowing', ARRAY['mowing between rows', 'tractor mowing', 'cortar pasto', 'chapear', 'rozar', 'pasar la desvaradora', 'corte de césped', 'mow'], 'soil'),
('Hand Weeding', ARRAY['hoeing', 'weeding by hand', 'cleaning under vines', 'azadonear', 'deshierbar', 'limpiar hierba', 'sacar maleza', 'escardar'], 'soil'),
('Tilling', ARRAY['cultivating', 'disc harrowing', 'plowing', 'rototilling', 'discing', 'rastrillar', 'arar', 'pasar el disco', 'cultivar'], 'soil'),
('Under-Vine Cultivation', ARRAY['in-row tillage', 'weed knife', 'French plow', 'cultivar debajo de la vid', 'pasar la cuchilla'], 'soil'),
('Compost Application', ARRAY['spreading compost', 'hauling compost', 'tirar composta', 'abonar', 'echar estiercol', 'applying compost', 'manure'], 'soil'),
('Fertilizer Application', ARRAY['spreading fertilizer', 'side dressing', 'banding', 'tirar fertilizante', 'abonar', 'aplicar granulado', 'fertilizing'], 'soil'),
('Cover Crop Seeding', ARRAY['planting cover crop', 'seeding between rows', 'sembrar cubierta', 'tirar semilla'], 'soil'),
('Cover Crop Mowing', ARRAY['mowing cover crop', 'cutting cover', 'chapear cubierta', 'cortar cubierta vegetal'], 'soil'),
('Mulching', ARRAY['spreading mulch', 'wood chip mulching', 'straw mulching', 'poner mulch', 'acolchar', 'tirar viruta'], 'soil'),
('Soil Sampling', ARRAY['taking soil samples', 'soil testing', 'sacar muestras de suelo', 'muestreo de tierra'], 'soil'),
('Erosion Control', ARRAY['building berms', 'erosion prevention', 'check dam', 'control de erosion', 'hacer bermas'], 'soil'),
('Ripping', ARRAY['deep ripping', 'subsoiling', 'breaking hardpan', 'ripear', 'subsoleo', 'romper piso duro'], 'soil'),
('Amendments Application', ARRAY['spreading lime', 'gypsum application', 'sulfur application', 'aplicar enmiendas', 'tirar yeso'], 'soil'),

-- Planting and Replanting
('Planting', ARRAY['vine planting', 'putting in new plants', 'field planting', 'plantar vides', 'sembrar plantas', 'poner plantas nuevas', 'plantación', 'plantar'], 'planting'),
('Replanting', ARRAY['interplanting', 'replanting dead spots', 'filling gaps', 'resembrar', 'reponer plantas muertas', 'rellenar huecos'], 'planting'),
('Vine Removal', ARRAY['pulling vines', 'ripping out old vines', 'arrancar vides', 'sacar plantas viejas', 'tumbar vinedo'], 'planting'),
('Grafting', ARRAY['chip budding', 'T-budding', 'field grafting', 'bench grafting', 'injertar', 'injerto de yema', 'hacer injertos'], 'planting'),
('Staking', ARRAY['vine stakes', 'bamboo staking', 'putting in stakes', 'poner tutores', 'estacar', 'poner bambu', 'entutorar'], 'planting'),
('Grow Tube Installation', ARRAY['vine shelters', 'putting on grow tubes', 'vine protectors', 'poner tubos', 'protectores de planta'], 'planting'),
('Layout / Surveying', ARRAY['staking rows', 'marking rows', 'measuring', 'GPS staking', 'marcar hileras', 'medir', 'trazar vinedo'], 'planting'),

-- General Maintenance
('Equipment Maintenance', ARRAY['fixing equipment', 'tractor maintenance', 'tool sharpening', 'arreglar equipo', 'mantenimiento', 'afilar herramientas'], 'maintenance'),
('Fence Repair', ARRAY['fencing', 'fixing fence', 'wire fence repair', 'arreglar cerca', 'poner cerca', 'componer cerco', 'alambrar'], 'maintenance'),
('Road Maintenance', ARRAY['grading roads', 'filling potholes', 'road gravel', 'arreglar caminos', 'nivelar', 'echar grava'], 'maintenance'),
('Frost Protection', ARRAY['running wind machines', 'frost watch', 'smudge pots', 'proteccion contra helada', 'prender ventiladores', 'vigilar helada'], 'maintenance'),
('Flagging Vines', ARRAY['flagging dead vines', 'marking for replanting', 'tagging', 'marcar vides', 'poner banderas', 'senalar plantas'], 'maintenance'),
('Vine Counting', ARRAY['plant count', 'stand count', 'vine census', 'inventory', 'contar plantas', 'inventario de vides'], 'maintenance'),
('Cleaning Equipment', ARRAY['washing bins', 'cleaning lugs', 'sanitizing', 'lavar botes', 'limpiar cajas', 'lavar equipo', 'cleaning bins'], 'maintenance');
