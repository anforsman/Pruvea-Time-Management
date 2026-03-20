-- 011: Seed data — default notification schedules and common vineyard tasks

-- Notification schedules
INSERT INTO notification_schedule (name, cron_expression, message_template_en, message_template_es) VALUES
  (
    'Evening Reminder',
    '0 17 * * 1-6',
    'Hi {name}, don''t forget to log your hours for today!',
    'Hola {name}, ¡no olvides registrar tus horas de hoy!'
  ),
  (
    'Morning Follow-up',
    '0 7 * * 2-7',
    'Hi {name}, it looks like you didn''t log hours yesterday. Reply with your hours to catch up!',
    'Hola {name}, parece que no registraste horas ayer. ¡Responde con tus horas para ponerte al día!'
  );

-- Common vineyard tasks with bilingual aliases for AI matching
INSERT INTO tasks (name, aliases, category) VALUES
  ('Pruning',           ARRAY['poda', 'podar', 'pruning'],                                          'vineyard'),
  ('Harvesting',        ARRAY['cosecha', 'cosechar', 'harvest', 'picking'],                         'vineyard'),
  ('Spraying',          ARRAY['fumigación', 'fumigar', 'spray'],                                    'vineyard'),
  ('Canopy Management', ARRAY['manejo de dosel', 'canopy', 'tucking', 'shoot thinning'],            'vineyard'),
  ('Irrigation',        ARRAY['riego', 'irrigación', 'watering'],                                   'vineyard'),
  ('Planting',          ARRAY['plantación', 'plantar', 'planting'],                                 'vineyard'),
  ('Trellis Repair',    ARRAY['reparación de espalderas', 'trellis', 'wire work'],                  'vineyard'),
  ('Mowing',            ARRAY['corte de césped', 'mowing', 'mow'],                                  'vineyard'),
  ('Leaf Pulling',      ARRAY['deshoje', 'leaf pull', 'defoliation'],                               'vineyard'),
  ('Suckering',         ARRAY['desbrote', 'sucker', 'suckering'],                                   'vineyard');
