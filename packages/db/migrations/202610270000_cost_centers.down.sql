-- Faz 6.9 rollback: maliyet merkezi / proje etiketi tablolarını kaldır.

DROP TABLE IF EXISTS expense_dimensions;
DROP TABLE IF EXISTS journal_line_dimensions;
DROP TABLE IF EXISTS invoice_line_dimensions;
DROP TABLE IF EXISTS project_tags;
DROP TABLE IF EXISTS cost_centers;