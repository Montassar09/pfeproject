-- Create photovoltaic production table if it doesn't exist
CREATE TABLE IF NOT EXISTS production_photovoltaique (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    mois VARCHAR(50),
    puissance_installee_kwp DECIMAL(10,2),
    production_journaliere_kwh DECIMAL(10,2),
    production_cumulee_kwh DECIMAL(10,2),
    heures_equivalentes_h DECIMAL(10,2),
    efficacite DECIMAL(5,2)
);

-- Insert sample data for testing
INSERT INTO production_photovoltaique (date, mois, puissance_installee_kwp, production_journaliere_kwh, production_cumulee_kwh, heures_equivalentes_h, efficacite) VALUES
('2024-01-15', 'Janvier 2024', 50.5, 120.5, 120.5, 8.5, 85.2),
('2024-01-16', 'Janvier 2024', 50.5, 135.8, 256.3, 9.2, 87.1),
('2024-01-17', 'Janvier 2024', 50.5, 98.2, 354.5, 6.8, 82.5),
('2024-01-18', 'Janvier 2024', 50.5, 145.6, 500.1, 8.9, 88.9),
('2024-01-19', 'Janvier 2024', 50.5, 112.3, 612.4, 7.2, 84.1);
